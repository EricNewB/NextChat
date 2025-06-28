import { NextResponse } from "next/server";

export async function GET() {
  const envVars = {
    BASE_URL: process.env.BASE_URL,
    OPENAI_API_KEY_EXISTS: !!process.env.OPENAI_API_KEY,
    OPENAI_URL_EXISTS: !!process.env.OPENAI_URL,
    HIDE_USER_API_KEY: process.env.HIDE_USER_API_KEY,
    CODE: process.env.CODE,
    NODE_ENV: process.env.NODE_ENV,
    BUILD_MODE: process.env.BUILD_MODE,
  };
  return NextResponse.json(envVars);
}

export const runtime = "edge";
