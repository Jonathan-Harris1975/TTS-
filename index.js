import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import longTtsRouter from "./routes/ttslong.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "podcast-tts-long-audio", version: "1.0.1" });
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.use("/tts/long", longTtsRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[tts-long] listening on :${port}`);
});
