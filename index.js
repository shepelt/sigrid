import { ChatOpenAI } from "@langchain/openai";
import 'dotenv/config';

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini", // 또는 gpt-4o
  temperature: 0,
});

const response = await model.invoke("what LLM model are you?");
console.log(response.content);