import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 4000;

  app.use(express.json());

  // Gemini API Proxy
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { message, context, mode } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      }

      const genAI = new GoogleGenAI({ apiKey });

      const systemPrompt = `You are the UAE Family Companion AI, an intelligent assistant for families in the United Arab Emirates. 
      Your current role is: ${mode || 'Family Advisor'}.
      
      Cultural Context:
      - You must respect UAE traditions, Islamic values, and local family hierarchies.
      - Be warm, respectful, and family-oriented.
      - Use terms like 'Majlis', 'Eid', 'Ramadan', 'Iftar' correctly.
      - Provide local suggestions for Emirates like Dubai, Abu Dhabi, Sharjah, etc.
      - Support large extended families.
      - Address parents, children, and elderly members with appropriate respect.
      
      Family Context: ${JSON.stringify(context)}
      
      Respond to the user's request in a helpful, culturally-aware manner. If requested, provide advice in both English and Arabic.`;

      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [systemPrompt, message],
      });
      res.json({ text: result.text });
    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Failed to generate AI response" });
    }
  });

  // Vite middleware for development
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
