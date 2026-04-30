import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

interface PokemonStat {
  base_stat: number;
  stat: { name: string };
}

interface PokemonType {
  type: { name: string };
}

interface PokemonAbility {
  ability: { name: string };
  is_hidden: boolean;
}

interface PokemonSprites {
  front_default: string | null;
}

interface PokemonData {
  id: number;
  name: string;
  height: number;
  weight: number;
  base_experience: number;
  types: PokemonType[];
  abilities: PokemonAbility[];
  stats: PokemonStat[];
  sprites: PokemonSprites;
}

const server = new McpServer({
  name: "pokemon-mcp",
  version: "1.0.0",
});

server.tool(
  "get_pokemon",
  "Fetch basic data for a Pokemon by name or Pokedex ID",
  { name: z.string().describe("Pokemon name (e.g. pikachu) or Pokedex ID (e.g. 25)") },
  async ({ name }) => {
    const identifier = name.trim().toLowerCase();
    let data: PokemonData;

    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${identifier}`);
      if (res.status === 404) {
        return {
          content: [{ type: "text", text: `Pokemon "${name}" not found. Check the spelling or try using the Pokedex number.` }],
          isError: true,
        };
      }
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `PokeAPI returned an error: ${res.status} ${res.statusText}` }],
          isError: true,
        };
      }
      data = await res.json() as PokemonData;
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to reach PokeAPI: ${(err as Error).message}` }],
        isError: true,
      };
    }

    const types = data.types.map((t) => t.type.name).join(", ");
    const abilities = data.abilities
      .map((a) => a.ability.name + (a.is_hidden ? " (hidden)" : ""))
      .join(", ");
    const stats = data.stats
      .map((s) => `${s.stat.name}: ${s.base_stat}`)
      .join("\n  ");

    const result = [
      `#${data.id} — ${data.name.charAt(0).toUpperCase() + data.name.slice(1)}`,
      `Type(s)     : ${types}`,
      `Height      : ${data.height / 10} m`,
      `Weight      : ${data.weight / 10} kg`,
      `Base exp    : ${data.base_experience}`,
      `Abilities   : ${abilities}`,
      `Base stats  :`,
      `  ${stats}`,
      data.sprites.front_default ? `Sprite      : ${data.sprites.front_default}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return { content: [{ type: "text", text: result }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Server error: ${err.message}\n`);
  process.exit(1);
});
