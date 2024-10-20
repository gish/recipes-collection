import { walk } from "jsr:@std/fs/walk";
import { extractYaml } from "jsr:@std/front-matter";
import { Database } from "jsr:@db/sqlite";
import { Hono } from "jsr:@hono/hono";
import { html, raw } from "jsr:@mark/html";
import { Renderer } from "jsr:@libs/markdown";

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
      "INSERT INTO recipes(name, content, title, category) values(:name, :content, :title, :category);",
      {
        name,
        content,
        category,
        title,
      }
    );
  }

  const app = new Hono();
  app.get("/", (c) => {
    const stmt = db.prepare(
      "SELECT name, content, title, category FROM recipes"
    );
    const recipes = [];
    for (const recipe of stmt.all()) {
      recipes.push(recipe);
    }
    const output = html` <html>
      <body>
        <h1>Recept</h1>
        <ul>
          ${recipes.map(
            (recipe) =>
              html`<li>
                <a href="/recept/${recipe.name}">${recipe.title}</a>
              </li>`
          )}
        </ul>
      </body>
    </html>`();
    return c.html(output);
  });

  app.get("/kategorier/:category", (c) => {
    const category = c.req.param("category");
    const stmt = db.prepare(
      "SELECT name, content, title, category FROM recipes WHERE LOWER(category) = ?"
    );
    const allRecipes = stmt.all(category);
    if (!allRecipes.length) {
      return c.json({ error: "not_found" }, 404);
    }
    const recipes = [];
    for (const recipe of allRecipes) {
      recipes.push(recipe);
    }
    const readableCategory = recipes.at(0)?.category;
    const output = html`<html>
      <body>
        <h1>${readableCategory}</h1>
        <ul>
          ${recipes.map(
            (recipe) =>
              html`<li>
                <a href="/recept/${recipe.name}">${recipe.title}</a>
              </li>`
          )}
        </ul>
        <a href="/">Tillbaka</a>
      </body>
    </html>`();

    return c.html(output);
  });

  app.get("/recept/:name", async (c) => {
    const stmt = db.prepare(
      "SELECT name, content, title, category FROM recipes WHERE name = ?"
    );
    const name = c.req.param("name");
    const allRecipes = stmt.all(name);
    if (!allRecipes.length) {
      return c.json({ error: "not_found" }, 404);
    }
    const recipe = allRecipes.at(0);
    if (recipe === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    const content = await Renderer.render(recipe.content);
    const categorySlug = recipe.category.toLowerCase();
    const output = html`<html>
      <body>
        <h1>${recipe.title}</h1>
        ${raw(content)}
        <p>
          Kategori:
          <a href="/kategorier/${categorySlug}">${recipe.category}</a><br />
        </p>
        <a href="/">Tillbaka</a>
      </body>
    </html>`();
    return c.html(output);
  });
  Deno.serve({ port: 8080 }, app.fetch);
};

bootstrap();
