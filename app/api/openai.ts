import { requestOpenai } from "./common";
import { auth } from "./auth";
import { ModelProvider } from "@/app/constant";
import { NextRequest, NextResponse } from "next/server";
import { prettyObject } from "@/app/utils/format";

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[OpenAI Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    // ALL requests should go through the common handler,
    // which is already fixed to use server-side config.
    return await requestOpenai(req);
  } catch (e) {
    console.error("[OpenAI Route Error] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "edge";
