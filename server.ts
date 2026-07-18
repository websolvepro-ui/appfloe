import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

// Load env variables
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Lazy initialize Gemini SDK with telemetry header and key validation
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY is not configured. Please add your Gemini API Key in the Settings > Secrets panel of AI Studio.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Resilient helper to call Gemini API with exponential backoff retries and model fallbacks for transient errors (e.g. 503 Service Unavailable)
async function callGeminiWithRetry(params: {
  contents: any;
  config?: any;
}): Promise<any> {
  const modelsToTry = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    let delay = 1000; // start with 1 second delay
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[Gemini API] Querying model ${model} (Attempt ${attempt}/3)...`);
        const ai = getGeminiClient();
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || String(error);
        const errorCode = error.status || error.code || (error.error && error.error.code);

        console.warn(`[Gemini API Error] Model: ${model}, Attempt: ${attempt}, Code: ${errorCode}, Message: ${errorMessage}`);

        // If it's a permanent auth error or key issue, do not retry, fail immediately
        if (
          errorMessage.includes("API key") || 
          errorMessage.includes("API_KEY") || 
          errorCode === 403 || 
          errorCode === 401
        ) {
          throw error;
        }

        // Wait before retrying
        if (attempt < 3) {
          console.log(`[Gemini API] Transient failure. Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2.5; // exponential backoff
        }
      }
    }
    console.warn(`[Gemini API] Model ${model} exhausted or returned 503s. Trying fallback model...`);
  }

  throw lastError;
}

// API endpoint for AI insights
app.post("/api/ai-insights", async (req, res) => {
  try {
    const { expenses, budgets, goals } = req.body;

    // Build the analysis prompt
    const prompt = `
      You are an expert, friendly AI financial counselor for Floe, a privacy-first personal finance application.
      Analyze the user's financial profile below and generate actionable, high-quality insights, a financial health score (0-100), and custom recommendations.

      Profile Data:
      1. Expenses (Transactions):
         ${JSON.stringify(expenses, null, 2)}

      2. Budgets (Category limits and allocations):
         ${JSON.stringify(budgets, null, 2)}

      3. Savings Goals:
         ${JSON.stringify(goals, null, 2)}

      Rule constraints for analysis:
      - Focus on spending trends: identify if they are exceeding or close to exceeding category budgets.
      - Highlight good savings habits or progress on savings goals.
      - Suggest specific categories where they can cut back or shift allocation if they are over budget.
      - Calculate a realistic financial health score (0-100) based on how well they adhere to budgets and goals.
      - Keep recommendations highly personal, supportive, objective, and realistic.
    `;

    const response = await callGeminiWithRetry({
      contents: prompt,
      config: {
        systemInstruction: "You are a professional financial advisor API. Return strictly valid JSON adhering to the specified schema.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            healthScore: { 
              type: Type.INTEGER, 
              description: "A score from 0 to 100 representing overall financial health based on budgets" 
            },
            summary: { 
              type: Type.STRING, 
              description: "A 2-3 sentence general summary of their recent financial state" 
            },
            insights: {
              type: Type.ARRAY,
              description: "High priority alerts, savings callouts, or budget notifications",
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  type: { 
                    type: Type.STRING, 
                    description: "The visual accent of the insight. Must be one of: 'warning', 'success', 'info'." 
                  },
                  category: { type: Type.STRING, description: "Associated category name or budget ID" }
                },
                required: ["title", "description", "type"]
              }
            },
            recommendations: {
              type: Type.ARRAY,
              description: "Tailored personal finance recommendations",
              items: {
                type: Type.STRING
              }
            }
          },
          required: ["healthScore", "summary", "insights", "recommendations"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response text received from Gemini.");
    }

    let cleanText = resultText.trim();
    if (cleanText.startsWith("```json")) {
      cleanText = cleanText.substring(7);
    }
    if (cleanText.endsWith("```")) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    res.json(JSON.parse(cleanText));
  } catch (error: any) {
    console.error("Gemini API error:", error);
    res.status(500).json({
      error: "Failed to generate financial insights",
      details: error.message || String(error)
    });
  }
});

// API endpoint for receipt extraction using Gemini
app.post("/api/receipt-extract", async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image || !mimeType) {
      return res.status(400).json({ error: "Missing receipt image or mimeType." });
    }

    // Clean base64 string if it contains data URI prefix
    let base64Data = image;
    if (image.includes(";base64,")) {
      base64Data = image.split(";base64,")[1];
    }

    const promptText = `
      Extract the following information from this receipt image:
      1. Merchant: Name of the business/merchant.
      2. Amount: The total grand total amount paid, as a float/number (e.g. 14.50). Do not include currency symbols.
      3. Date: Transaction date in standard YYYY-MM-DD format. If not found or unclear, use today's date: ${new Date().toISOString().split('T')[0]}.
      4. Suggested Category ID: Match the purchase to the most appropriate category ID from this list:
         - 'groceries' (for supermarket, grocery store, raw food ingredients, organic markets)
         - 'dining' (for restaurants, cafes, fast food, coffee shops, bars)
         - 'transport' (for Uber, Lyft, taxis, gas stations, train tickets, flights, parking)
         - 'entertainment' (for movies, streaming, concerts, events, games, sports)
         - 'utilities' (for electric, internet, phone bills, water, gas, home upkeep)
         - 'shopping' (for clothing, electronics, retail stores, department stores, general merchandise)
    `;

    const imagePart = {
      inlineData: {
        mimeType: mimeType,
        data: base64Data,
      },
    };

    const response = await callGeminiWithRetry({
      contents: { parts: [imagePart, { text: promptText }] },
      config: {
        systemInstruction: "You are an automated receipt processing scanner. Read the text and image of the receipt, extract the exact total paid, merchant name, transaction date, and classify the category. Return strictly valid JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchant: { 
              type: Type.STRING, 
              description: "The name of the merchant" 
            },
            amount: { 
              type: Type.NUMBER, 
              description: "The grand total amount on the receipt as a float/number" 
            },
            date: { 
              type: Type.STRING, 
              description: "The date of the transaction as YYYY-MM-DD" 
            },
            category: { 
              type: Type.STRING, 
              description: "One of the specific category IDs: 'groceries', 'dining', 'transport', 'entertainment', 'utilities', 'shopping'" 
            }
          },
          required: ["merchant", "amount", "date", "category"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response received from Gemini model.");
    }

    let cleanText = resultText.trim();
    if (cleanText.startsWith("```json")) {
      cleanText = cleanText.substring(7);
    }
    if (cleanText.endsWith("```")) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    return res.json(JSON.parse(cleanText));
  } catch (error: any) {
    console.error("Receipt extraction error:", error);
    return res.status(500).json({
      error: "Failed to extract receipt data",
      details: error.message || String(error)
    });
  }
});

// Stripe checkout endpoint with simulation and live routes
app.post("/api/stripe-checkout", async (req, res) => {
  try {
    const { planId, userEmail, userId } = req.body;
    if (!planId || !userId) {
      return res.status(400).json({ error: "Missing required checkout parameters." });
    }

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      // Simulation fallback: allows instant testing of pricing subscription tiers in the container sandbox
      return res.json({
        isSimulated: true,
        redirectUrl: `/?payment_status=success&plan=${planId}&userId=${userId}&session_id=sim_${Date.now()}`
      });
    }

    // Lazy load Stripe to prevent startup crashes when keys are missing
    const StripeModule = await import("stripe");
    const stripe = new StripeModule.default(key, { apiVersion: "2023-10-16" as any });

    const priceAmount = planId === "lifetime" ? 4900 : (planId === "pro-yearly" ? 2999 : 399);
    const mode = planId === "lifetime" ? "payment" : "subscription";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: userEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: planId === "lifetime" ? "Floe Lifetime Premium" : `Floe Pro Plan (${planId === "pro-yearly" ? "Yearly" : "Monthly"})`,
              description: planId === "lifetime" ? "Floe private, manual, voice, and receipt scanning budget tracker." : "Floe private Pro Plan with 14-day free trial.",
            },
            unit_amount: priceAmount,
            recurring: planId === "lifetime" ? undefined : {
              interval: planId === "pro-yearly" ? "year" : "month",
            },
          },
          quantity: 1,
        },
      ],
      mode: mode,
      subscription_data: mode === "subscription" ? {
        trial_period_days: 14,
      } : undefined,
      success_url: `${req.headers.origin || "http://localhost:3000"}/?payment_status=success&plan=${planId}&userId=${userId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || "http://localhost:3000"}/?payment_status=cancelled`,
      metadata: {
        userId,
        planId,
      },
    });

    return res.json({ isSimulated: false, redirectUrl: session.url });
  } catch (err: any) {
    console.error("Stripe checkout session creation failed:", err);
    return res.status(500).json({ error: "Failed to initiate Stripe Checkout Session", details: err.message });
  }
});


// Setup Vite Dev server or production static serving
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupVite().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
});
