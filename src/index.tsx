import { walk } from "jsr:@std/fs/walk";
import { extractYaml } from "jsr:@std/front-matter";
import { Database } from "jsr:@db/sqlite";
import { Hono } from "jsr:@hono/hono";

type FrontMatter = {
  title: string | undefined;
  category: string | undefined;
  body: string;
};
type Recipe = {
  name: string;
  content: string;
  category: string;
  title: string;
};

const extractFrontMatter = (markdown: string): FrontMatter | null => {
  try {
    const frontMatterExtract = extractYaml<FrontMatter>(markdown);
    const { title, category } = frontMatterExtract.attrs;
    const body = frontMatterExtract.body;
    return { title, category, body };
  } catch (_) {
    return null;
  }
};
const getRecipes = async () => {
  const files: Recipe[] = [];
  const path = "./src/recipes";
  for await (const dirEntry of walk(path, { exts: ["md"] })) {
    const fileContent = await Deno.readTextFile(`${path}/${dirEntry.name}`);
    const name = dirEntry.name.replace(".md", "");
    const frontMatter = extractFrontMatter(fileContent);
    if (!frontMatter?.body) {
      console.error(`missing content for ${name}`);
      continue;
    }
    if (!frontMatter?.category) {
      console.error(`missing category for ${name}`);
      continue;
    }
    if (!frontMatter?.title) {
      console.error(`missing title for ${name}`);
      continue;
    }
    files.push({
      name,
      content: frontMatter.body,
      title: frontMatter.title,
      category: frontMatter.category,
    });
  }
  return files;
};

const bootstrap = async () => {
  const recipes = await getRecipes();
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE IF NOT EXISTS recipes(name VARCHAR(255), content TEXT, title TEXT, category TEXT);`
  );

  for (const recipe of recipes) {
    const { name, content, title, category } = recipe;
    db.exec(
      "INSERT INTO recipes(name, content, title, category) values(:name, :content, :category, :title);",
      {
        name,
        content,
        title,
        category,
      }
    );
  }

  const app = new Hono();
  app.get("/recept", (c) => {
    const stmt = db.prepare(
      "SELECT name, content, title, category FROM recipes"
    );
    const all = [];
    for (const recipe of stmt.all()) {
      all.push(recipe);
    }
    return c.json(all);
  });
  app.get("/recept/:name", (c) => {
    const stmt = db.prepare(
      "SELECT name, content, title, category FROM recipes WHERE name = ?"
    );
    const name = c.req.param("name");
    const recipe = stmt.all(name);
    if (!recipe.length) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(recipe.at(0));
  });
  Deno.serve({ port: 8080 }, app.fetch);
};

bootstrap();
