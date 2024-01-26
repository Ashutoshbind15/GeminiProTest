import express from "express";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mongoose from "mongoose";

// Config

dotenv.config();

const global = {};

const connectDB = async () => {
  try {
    if (global.isConnected) {
      console.log("already connected");
      return;
    }
    if (mongoose.connections.length > 0) {
      global.isConnected = mongoose.connections[0].readyState;
      if (global.isConnected === 1) {
        console.log("use previous connection");
        return;
      }
      await mongoose.disconnect();
    }
    const db = await mongoose.connect(process.env.MONGO_URI);
    console.log("new connection");
    global.isConnected = db.connections[0].readyState;
  } catch (error) {
    console.log(error);
  }
};

// Initialization for the app

const generativeAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
await connectDB();
const app = express();

// Middleware

app.use(express.json());

// Models

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "model"], // Role can be 'user' or 'model'
    required: true,
  },
  parts: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const conversationSchema = new mongoose.Schema({
  messages: [messageSchema], // An array of messages
});

const Chat = mongoose.model("Chat", conversationSchema);

// Util functions

const generateChatResponses = async (prompt, chatId = -1, config = {}) => {
  if (chatId == -1) {
    const chat = new Chat();
    await chat.save();
    chatId = chat._id;
  }
  const model = generativeAI.getGenerativeModel({ model: "gemini-pro" });
  const history = await Chat.findById(chatId);
  const chat = model.startChat({
    history: history?.messages.map((message) => {
      return {
        role: message.role,
        parts: message.parts,
      };
    }),
    generationConfig: config,
  });

  const result = await chat.sendMessage(prompt);

  const userMessage = {
    role: "user",
    parts: prompt,
  };

  const response = await result.response;
  const text = response.text();

  const modelMessage = {
    role: "model",
    parts: text,
  };

  const updatedChat = await Chat.findByIdAndUpdate(
    chatId,
    { $push: { messages: [userMessage, modelMessage] } },
    { new: true }
  );

  console.log(updatedChat);

  return text;
};

const generateSingleTextResponse = async (
  prompt = "Write a story about a magic backpack."
) => {
  const model = generativeAI.getGenerativeModel({ model: "gemini-pro" });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();
  return text;
};

const streamChunkHandler = (chunk) => {
  return chunk.text();
};

async function handleStreamResponse(stream, streamChunkHandler) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on("data", (chunk) => {
      chunks.push(streamChunkHandler(chunk));
    });

    stream.on("end", () => {
      const data = Buffer.concat(chunks);
      resolve(data.toString()); // Assuming it's a text stream, convert it to a string and resolve the promise
    });

    stream.on("error", (error) => {
      reject(error);
    });
  });
}

const simplerStreamHandler = async (stream) => {
  let res = "";
  for await (const chunk of stream) {
    res += streamChunkHandler(chunk);
    console.log(res);
  }
  return res;
};

const generateSingleTextStreamResponse = async (prompt) => {
  const model = generativeAI.getGenerativeModel({ model: "gemini-pro" });
  const responseStream = await model.generateContentStream(prompt);
  const res = await simplerStreamHandler(responseStream.stream);
  return res;
};

const getChats = async () => {
  const chats = await Chat.find();
  return chats;
};

// Routes

app.get("/chat", async (req, res) => {
  const chats = await getChats();
  return res.status(200).send(chats);
});

app.get("/", async (req, res) => {
  //   const text = await generateSingleTextResponse();
  //   const chatResponse = await generateChatResponses(
  //     msg, id
  //   );

  //   const streamResponse = await generateSingleTextStreamResponse(
  //     "Write a spooky yet funny story."
  //   );

  return res.status(200).send(streamResponse);
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
