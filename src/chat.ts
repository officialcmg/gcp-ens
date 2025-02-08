import { getAgent } from './agentStore';
import { HumanMessage } from "@langchain/core/messages";


export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { prompt } = await req.json();
    const agent = await getAgent();
    
    // Set up streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Process in background
    (async () => {
      try {
        const agentStream = await agent.stream(
          { messages: [new HumanMessage(prompt)] }
        );

        for await (const chunk of agentStream) {
          let content = '';
          if ("agent" in chunk) {
            content = chunk.agent.messages[0].content;
          } else if ("tools" in chunk) {
            content = chunk.tools.messages[0].content;
          }
          
          // Send each chunk as a server-sent event
          if (content) {
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
            );
          }
        }
      } catch (error) {
        console.error('Stream error:', error);
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ error: 'Processing error' })}\n\n`)
        );
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }), 
      { status: 500 }
    );
  }
}
