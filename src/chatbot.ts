import {
  AgentKit,
  CdpWalletProvider,
  wethActionProvider,
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  pythActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as readline from "readline";

// Import the fetchsubgraph() function from the local file (fetchgraph.ts)
import { fetchsubgraph, fetchRegistrationCount } from "./fetchgraph";

dotenv.config();

/**
 * Validates that required environment variables are set
 *
 * @throws {Error} - If required environment variables are missing
 * @returns {void}
 */
function validateEnvironment(): void {
  const missingVars: string[] = [];

  // Check required variables
  const requiredVars = ["OPENAI_API_KEY", "CDP_API_KEY_NAME", "CDP_API_KEY_PRIVATE_KEY"];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  // Exit if any required variables are missing
  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach(varName => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  // Warn about optional NETWORK_ID
  if (!process.env.NETWORK_ID) {
    console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
  }
}
validateEnvironment();

// File to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = "wallet_data.txt";

/**
 * Helper function to fetch text records for a given query.
 * This function makes a GET request to "https://ensdata.net/<query>"
 * and returns the JSON response.
 */
async function fetchTextRecords(query: string): Promise<any> {
  try {
    const response = await fetch(`https://ensdata.net/${query}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error("Error fetching text records:", error.message);
    throw error;
  }
}

/**
 * Initialize the agent with CDP Agentkit.
 *
 * @returns An object containing the agent instance and its configuration.
 */
async function initializeAgent() {
  try {
    // Initialize LLM
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    let walletDataStr: string | null = null;

    // Read existing wallet data if available
    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
      }
    }

    // Configure CDP Wallet Provider
    const config = {
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      cdpWalletData: walletDataStr || undefined,
      networkId: process.env.NETWORK_ID || "base-sepolia",
    };

    const walletProvider = await CdpWalletProvider.configureWithWallet(config);

    // Initialize AgentKit with various action providers
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        wethActionProvider(),
        pythActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        cdpWalletActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      ],
    });

    const fetchTextRecordsTool = new DynamicTool({
      name: "fetchTextRecords",
      description: "Fetches ENS text records for a given domain name or wallet address.",
      func: async (input) => {
        const result = await fetchTextRecords(input);
        return JSON.stringify(result);
      },
    });

    const fetchsubgraphTool = new DynamicTool({
      name: "fetchsubgraph",
      description: "Fetches the latest ENS domain registrations from the subgraph API for the past specified hours.",
      func: async (input) => {
        const hours = parseInt(input, 10);
        if (isNaN(hours)) {
          throw new Error("Invalid input: hours must be a number.");
        }
        const result = await fetchsubgraph(hours);
        return JSON.stringify(result);
      },
    });

    const fetchRegistrationCountTool = new DynamicTool({
      name: "fetchRegistrationCount",
      description: "Fetches the number of ENS domain registrations from the subgraph API for the past specified hours. Returns a number",
      func: async (input) => {
        const hours = parseInt(input, 10);
        if (isNaN(hours)) {
          throw new Error("Invalid input: hours must be a number.");
        }
        const result = await fetchRegistrationCount(hours);
        return JSON.stringify(result);
      },
    });



    const tools = await getLangChainTools(agentkit);
    tools.push(fetchTextRecordsTool);
    tools.push(fetchsubgraphTool);
    tools.push(fetchRegistrationCountTool);
    const memory = new MemorySaver();
    const agentConfig = { configurable: { thread_id: "ENS Savant" } };

    // Create React Agent using the LLM and CDP Agentkit tools.
    // The messageModifier instructs the agent to infer what ENS data to fetch based on user input.
    // It can call:
    //   - fetchsubgraph() to retrieve the latest ENS domain registrations.
    //   - fetchTextRecords(query) to retrieve text records for a specified wallet or ENS name.
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
You are ENS Savant, an AI agent that provides users with up-to-date information on ENS data.
Your capabilities include:
1. Fetching the latest ENS domain registrations by using the 'fetchsubgraph' tool and passing in the hours, which returns data from a GraphQL API. The hours parameter specifies the time period e.g registrations in the last 24 hours
2. Fetching the latest ENS domain registrations by using the 'fetchRegistrationCount' tool and passing in the hours, which returns the number of ENS domain registrations in the past number of specified hours. The hours parameter specifies the time period e.g registrations in the last 24 hours
3. Retrieving text records for a specified ENS name or wallet by using the 'fetchTextRecords' tool and passing in the query (ens name or ens address)".

When a user says something like "show me the latest ENS registrations in the last 3 hours", you should use the 'fetchsubgraph' tool and pass in 3 and present the results.
When a user says something like "how many ENS domains were registered in the last 24 hours", you should use the 'fetchRegistrationCount' tool and pass in 24 and present the result, which will be a number e.g 1000.
The ENS registrations come in a format that looks like this:
{ nameRegistereds: [
    {
      blockNumber: "21797586"
      blockTimestamp: "1738966931"
      id: "0x57500e790b83e93ccfcc7a9c62a98ea06fb5a69236d2d5d7113caa5f19c3894bca030000"
      name: "dandybeegee"
      owner: "0x10b836dd56108944d99c0199d54c98105cce70da"
      transactionHash: "0x57500e790b83e93ccfcc7a9c62a98ea06fb5a69236d2d5d7113caa5f19c3894b"
    },
    {
      ...
    }
  ]
}
The fetchsubgraph tool returns an array of objects, with name(ens domain), owner, and other details as properties

If the user asks for text records (e.g., "get text records for ens.eth" or "get text records for 0x123..."), use the 'fetchTextRecords' tool with the given query.
If you are unsure of the user's intent, ask clarifying questions.
Provide the results in a clear, concise JSON format.
      `,
    });

    // Save wallet data
    const exportedWallet = await walletProvider.exportWallet();
    fs.writeFileSync(WALLET_DATA_FILE, JSON.stringify(exportedWallet));

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

/**
 * Run the agent autonomously with specified intervals.
 *
 * @param agent - The agent executor.
 * @param config - Agent configuration.
 * @param interval - Time interval between actions in seconds.
 */
async function runAutonomousMode(agent: any, config: any, interval = 10) {
  console.log("Starting autonomous mode...");

  while (true) {
    try {
      const thought =
        "Analyze recent ENS activity and provide insights based on the latest registrations.";
      const stream = await agent.stream({ messages: [new HumanMessage(thought)] }, config);

      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log(chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log(chunk.tools.messages[0].content);
        }
        console.log("-------------------");
      }

      await new Promise(resolve => setTimeout(resolve, interval * 1000));
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error:", error.message);
      }
      process.exit(1);
    }
  }
}

/**
 * Run the agent interactively based on user input.
 *
 * @param agent - The agent executor.
 * @param config - Agent configuration.
 */
async function runChatMode(agent: any, config: any) {
  console.log("Starting ENS Savant (chat mode)... Type 'exit' to end.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  try {
    while (true) {
      const userInput = await question("\nPrompt: ");

      if (userInput.toLowerCase() === "exit") {
        break;
      }

      const stream = await agent.stream({ messages: [new HumanMessage(userInput)] }, config);

      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log(chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log(chunk.tools.messages[0].content);
        }
        console.log("-------------------");
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Choose whether to run in autonomous or chat mode based on user input.
 *
 * @returns Selected mode.
 */
async function chooseMode(): Promise<"chat" | "auto"> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  while (true) {
    console.log("\nAvailable modes:");
    console.log("1. chat    - Interactive chat mode");
    console.log("2. auto    - Autonomous action mode");

    const choice = (await question("\nChoose a mode (enter number or name): "))
      .toLowerCase()
      .trim();

    if (choice === "1" || choice === "chat") {
      rl.close();
      return "chat";
    } else if (choice === "2" || choice === "auto") {
      rl.close();
      return "auto";
    }
    console.log("Invalid choice. Please try again.");
  }
}

/**
 * Main entry point for the ENS Savant agent.
 */
async function main() {
  try {
    const { agent, config } = await initializeAgent();
    const mode = await chooseMode();

    if (mode === "chat") {
      await runChatMode(agent, config);
    } else {
      await runAutonomousMode(agent, config);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Fatal error:", error.stack);
    } else {
      console.error("Fatal error:", JSON.stringify(error, null, 2));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  console.log("Starting Agent...");
  main().catch(error => {
    if (error instanceof Error) {
      console.error("Fatal error:", error.stack);
    } else {
      console.error("Fatal error:", JSON.stringify(error, null, 2));
    }
    process.exit(1);
  });
}
 
/*
Instructions for adding additional data sources:
1. Create new helper functions (similar to fetchsubgraph() or fetchTextRecords()) to query additional APIs or endpoints.
2. Import those functions into chatbot.ts.
3. Update the agent's messageModifier to inform it about the new capabilities and when to call the new functions.
4. You can also add new action providers to AgentKit if the new data source should be available as a tool.
5. Follow the same error handling and data formatting patterns as shown above.
*/

async function runAgentOnce(prompt: string): Promise<string> {
  try {
    const { agent, config } = await initializeAgent();
    let result = '';
    const stream = await agent.stream({ messages: [new HumanMessage(prompt)] }, config);
    for await (const chunk of stream) {
      if ("agent" in chunk) {
        result += chunk.agent.messages[0].content;
      } else if ("tools" in chunk) {
        result += chunk.tools.messages[0].content;
      }
    }
    return result;
  } catch (error) {
    console.error("Error running agent for prompt:", prompt, error);
    throw error;
  }
}

export { runAgentOnce };
export { initializeAgent };