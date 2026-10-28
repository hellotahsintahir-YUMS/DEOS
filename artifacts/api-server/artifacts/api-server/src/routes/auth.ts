import { Router, type IRouter } from "express";
import { oauth2Client } from "../lib/google";

const router: IRouter = Router();

router.get("/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    const { tokens } = await oauth2Client.getToken(code);
    req.session!.tokens = tokens;
    res.redirect("/");
  } catch (err) {
    res.status(500).send("Auth failed");
  }
});

export default router;
