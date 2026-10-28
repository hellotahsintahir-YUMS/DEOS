import { Router, type IRouter } from "express";
import { ai } from "../lib/gemini";

const router: IRouter = Router();

router.post("/", async (req, res) => {
  try {
    const message = req.body.message;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: message,
      config: {
        systemInstruction: "You are a kind tutor. Never give the final answer. Only ask guiding questions or give small hints. Keep sentences short.",
        temperature: 0.2,
      },
    });
    res.json({ reply: response.text });
  } catch (err) {
    res.status(500).json({ error: "Chat failed" });
  }
});

export default router;
