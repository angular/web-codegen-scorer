from browser_use.llm import ChatGoogle
from browser_use import Agent, Controller, ActionResult, BrowserSession
from dotenv import load_dotenv
import os
import argparse
import json
import base64
from models import AgentOutput, TakeFailureScreenshotParams, FailureScreenshot

load_dotenv()

import asyncio


async def main():
    os.environ["ANONYMIZED_TELEMETRY"] = "false"
    os.environ["BROWSER_USE_LOGGING_LEVEL"] = "error"

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--task", required=True, help="Path to the JSON file with task details."
    )
    args = parser.parse_args()

    with open(args.task, "r") as f:
        task_details = json.load(f)

    app_prompt = task_details.get("appPrompt")
    userJourneys = task_details.get("userJourneys")

    with open("system.md", "r") as f:
        base_instructions = f.read()

    task = f"""
{base_instructions}

## Task Details

Here are the details for your current task:

- **Live URL:** {os.environ.get("EVAL_TOOL_APP_URL")}
- **Original Prompt:**
```
{app_prompt}
```
- **User Journeys to verify:**
```json
{json.dumps(userJourneys, indent=4)}
```
"""

    controller = Controller(output_model=AgentOutput)

    @controller.action("Take User Journey failure screenshot")
    async def take_user_journey_screenshot(
        params: TakeFailureScreenshotParams, browser_session: BrowserSession
    ) -> ActionResult:
        page = await browser_session.get_current_page()
        screenshot_data = await page.screenshot(
            full_page=True, type="png", animations="disabled"
        )
        return ActionResult(
            extracted_content="""Successfully took screenshot. Screenshot in base64 format:
```
{screenshot_base64}
```
""".format(screenshot_base64=base64.b64encode(screenshot_data).decode("utf-8")),
    include_in_memory=True)

    llm = ChatGoogle(model="gemini-2.0-flash-lite-preview-02-05")
    browser_session = BrowserSession(headless=True)
    agent = Agent(
        task=task,
        llm=llm,
        use_vision=True,
        max_failures=5,
        retry_delay=5,
        max_actions_per_step=1,
        step_timeout=100,
        generate_gif=False,
        save_conversation_path=None,
        flash_mode=True,
        browser_session=browser_session,
        controller=controller,
    )
    result = await agent.run(max_steps=200)
    output_json = result.final_result()

    # No output typically means there were errors.. Likely due to timeouts.
    if output_json == None:
        output_json = json.dumps(
            {
                "errors": result.errors(),
            }
        )

    # `main.ts` exposes fd3 for the output result.
    # browser-use pollutes the stdout/stdin
    with os.fdopen(3, "w") as f:
        f.write(output_json)


asyncio.run(main())
