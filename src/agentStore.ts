import { initializeAgent } from './chatbot';

let agentInstance: any = null;
let initializationPromise: Promise<any> | null = null;

// singleton pattern
// This ensures we only initialize one agent instance
export async function getAgent() {
  // Return existing agent if we have one
  if (agentInstance) return agentInstance;
  
  // If we're already initializing, wait for that to complete
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      const { agent } = await initializeAgent();
      agentInstance = agent;
      return agent;
    } catch (error) {
      console.error('Failed to initialize agent:', error);
      // Reset on error so we can try again
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}