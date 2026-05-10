#!/usr/bin/env python3
"""Agentic loop: LM Studio model + momentum-mcp tools."""

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from openai import OpenAI

load_dotenv(Path(__file__).parent / ".env")

MODEL = os.environ["LM_MODEL"]
LM_STUDIO_URL = os.environ["LM_STUDIO_URL"]
API_KEY = os.environ["LM_API_KEY"]

MCP_DIR = Path(__file__).parent / "momentum-mcp"
MCP_ENV = {
    **os.environ,
    "DATABASE_URL": os.environ["DATABASE_URL"],
}


def to_openai_tool(tool):
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or "",
            "parameters": tool.inputSchema,
        },
    }


async def run(user_input: str):
    server_params = StdioServerParameters(
        command="node",
        args=[str(MCP_DIR / "dist/src/index.js")],
        env=MCP_ENV,
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools_result = await session.list_tools()
            tools = [to_openai_tool(t) for t in tools_result.tools]

            lm = OpenAI(api_key=API_KEY, base_url=LM_STUDIO_URL)
            messages = [{"role": "user", "content": user_input}]

            while True:
                response = lm.chat.completions.create(
                    model=MODEL,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                )

                msg = response.choices[0].message
                messages.append(msg)

                if not msg.tool_calls:
                    print(msg.content)
                    break

                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments)
                    print(f"[tool] {tc.function.name}({args})", file=sys.stderr)
                    result = await session.call_tool(tc.function.name, args)
                    content = "\n".join(
                        c.text if hasattr(c, "text") else json.dumps(c)
                        for c in result.content
                    )
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": content,
                    })


if __name__ == "__main__":
    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "what are my tasks"
    asyncio.run(run(query))
