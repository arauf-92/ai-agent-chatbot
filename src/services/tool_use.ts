import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import { pool } from '../db/pool.js';

async function get_weather(city: string): Promise<string> {
    try {
        if (!city) {
            console.error("No city provided for weather lookup");
            return "Please provide a city name";
        }
        let weatherData = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`);
        let datax: any = await weatherData.json();
        return `The current weather in ${city} is ${datax.weather[0].description} with a temperature of ${datax.main.temp}°C.`;
    } catch (error) {
        console.error("Error fetching weather data:", (error as Error).message);
        return "Sorry, I couldn't fetch the weather information";
    }
}

async function performWebSearch(query: string): Promise<string> {
    try {
        const response = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
            {
                headers: {
                    'X-Subscription-Token': process.env.BRAVE_API_KEY,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Search API error: ${response.status}`);
        }

        const data: any = await response.json();
        const results = data.web?.results?.slice(0, 3) || [];

        if (results.length === 0) {
            return "No search results found.";
        }

        return results
            .map((r: any, i: number) => `${i + 1}. ${r.title}\n${r.description}\nSource: ${r.url}`)
            .join('\n\n');
    } catch (error) {
        console.error("Web search error:", (error as Error).message);
        return "Sorry, I couldn't perform the web search right now.";
    }
}

async function getAllMemories(): Promise<string[]> {
    const result = await pool.query(`SELECT fact FROM memories ORDER BY created_at DESC LIMIT 20`);
    return result.rows.map(row => row.fact);
}

let cachedMemories: string[] | null = null;
async function getSystemPrompt(): Promise<string | undefined> {
    if (cachedMemories === null) {
        cachedMemories = await getAllMemories();
    }
    return cachedMemories.length > 0 ? `Known facts about the user:\n${cachedMemories.map(m => `- ${m}`).join('\n')}` : undefined;
}

async function saveMemory(fact: string): Promise<string> {
    try {
        await pool.query(
            `INSERT INTO memories (fact) VALUES ($1)`,
            [fact]
        );
        cachedMemories = null; // force refetch next time getSystemPrompt() is called
        return `Got it, I'll remember: ${fact}`;
    } catch (error) {
        console.error("Save memory error:", (error as Error).message);
        return "Sorry, I couldn't save that.";
    }
}

const tools: Anthropic.Tool[] = [
    {
        name: "get_weather",
        description: "Get the current weather for a given city. Returns a natural-language description of the current conditions (weather description and temperature in Celsius) for the specified city.",
        input_schema: {
            type: "object",
            properties: {
                city: {
                    type: "string",
                    description: "The name of the city to get weather for, e.g. 'San Francisco' or 'London'. Include the country or state if the city name is ambiguous, e.g. 'Paris, France' or 'Portland, OR'.",
                },
            },
            required: ["city"]
        }
    },
    {
        name: "web_search",
        description: "Search the web for current information not available in training data, such as recent news or real-time facts.",
        input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "The search query" } },
            required: ["query"]
        }
    },
    {
        name: "save_memory",
        description: "Save a fact the user wants remembered for later in the conversation, such as a preference or piece of personal information.",
        input_schema: {
            type: "object",
            properties: { fact: { type: "string", description: "The fact to remember" } },
            required: ["fact"]
        }
    }
];

export { get_weather, performWebSearch, getSystemPrompt, saveMemory, tools };