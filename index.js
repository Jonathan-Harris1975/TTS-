import express from "express";
import dotenv from "dotenv";
import composeRouter from "./routes/compose.js";
import ttsLongRouter from "./routes/ttsLong.js";

dotenv.config();
const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Podcast TTS Long Audio API" });
});

app.use("/compose", composeRouter);
app.use("/tts/long", ttsLongRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
