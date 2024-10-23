import { walk } from "jsr:@std/fs/walk";
import { extractYaml } from "jsr:@std/front-matter";
import { Database } from "jsr:@db/sqlite";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { compress } from "hono/compress";
import { html, raw } from "jsr:@mark/html";
import { Renderer } from "jsr:@libs/markdown";

type MarkdownContent = {
  title: string | undefined;
  category: string | undefined;
  body: string;
  source: string | undefined;
};
type Recipe = {
  slug: string;
  content: string;
  category: string;
  title: string;
  source: string;
};

const extractMarkdownContent = (markdown: string): MarkdownContent | null => {
  try {
    const frontMatterExtract = extractYaml<MarkdownContent>(markdown);
    const { title, category, source } = frontMatterExtract.attrs;
    const body = frontMatterExtract.body;
    return { title, category, body, source };
  } catch (_) {
    return null;
  }
};
const getRecipes = async () => {
  const files: Recipe[] = [];
  const path = "./src/recipes";
  for await (const dirEntry of walk(path, { exts: ["md"] })) {
    const fileContent = await Deno.readTextFile(`${path}/${dirEntry.name}`);
    const slug = dirEntry.name.replace(".md", "");
    const frontMatter = extractMarkdownContent(fileContent);
    if (!frontMatter?.body) {
      console.error(`missing content for ${slug}`);
      continue;
    }
    if (!frontMatter?.category) {
      console.error(`missing category for ${slug}`);
      continue;
    }
    if (!frontMatter?.title) {
      console.error(`missing title for ${slug}`);
      continue;
    }
    if (!frontMatter?.source) {
      console.error(`missing source for ${slug}`);
      continue;
    }
    files.push({
      slug,
      content: frontMatter.body,
      title: frontMatter.title,
      category: frontMatter.category,
      source: frontMatter.source,
    });
  }
  return files;
};

const bootstrap = async () => {
  const recipes = await getRecipes();
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE IF NOT EXISTS recipes(slug TEXT, content TEXT, title TEXT, category TEXT, source TEXT);`
  );

  for (const recipe of recipes) {
    const { slug, content, title, category, source } = recipe;
    db.exec(
      "INSERT INTO recipes(slug, content, title, category, source) values(:slug, :content, :title, :category, :source);",
      {
        slug,
        content,
        category,
        title,
        source,
      }
    );
  }

  const layout = (title: string, children: ReturnType<typeof html>) => {
    return html`<html>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css"
        />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${title} - Recept</title>
      </head>
      <body>
        ${raw(children())}
      </body>
    </html>`();
  };

  const notFoundPage = layout(
    "Sidan finns inte",
    html`Hoppsan, sidan finns inte`
  );

  const app = new Hono();
  app.use(compress());

  app.get("/", (c) => {
    const stmt = db.prepare(
      "SELECT slug, content, title, category FROM recipes ORDER BY title"
    );
    const recipes = [];
    for (const recipe of stmt.all()) {
      recipes.push(recipe);
    }
    const output = html` <h1>Recept</h1>
      <ul>
        ${recipes.map(
          (recipe) =>
            html`<li>
              <a href="/recept/${recipe.slug}">${recipe.title}</a>
            </li>`
        )}
      </ul>`;
    const page = layout("Start", output);
    return c.html(page);
  });

  app.get("/kategorier/:category", (c) => {
    const category = c.req.param("category");
    const stmt = db.prepare(
      "SELECT slug, content, title, category FROM recipes WHERE category = ? ORDER BY title"
    );
    const allRecipes = stmt.all(category);
    if (!allRecipes.length) {
      return c.html(notFoundPage, 404);
    }
    const recipes = [];
    for (const recipe of allRecipes) {
      recipes.push(recipe);
    }
    const readableCategory = recipes.at(0)?.category;
    const output = html`
      <h1>${readableCategory}</h1>
      <ul>
        ${recipes.map(
          (recipe) =>
            html`<li>
              <a href="/recept/${recipe.slug}">${recipe.title}</a>
            </li>`
        )}
      </ul>
      <a href="/">Start</a>
    `;

    const page = layout(readableCategory, output);
    return c.html(page);
  });

  app.use("/recept/*", etag());

  app.get("/recept/:slug", async (c) => {
    const stmt = db.prepare(
      "SELECT slug, content, title, category FROM recipes WHERE slug = ?"
    );
    const slug = c.req.param("slug");
    const allRecipes = stmt.all(slug);
    if (!allRecipes.length) {
      return c.html(notFoundPage, 404);
    }
    const recipe = allRecipes.at(0);
    if (recipe === undefined) {
      return c.html(notFoundPage, 404);
    }
    const content = await Renderer.render(recipe.content);
    const categorySlug = recipe.category.toLowerCase();
    const output = html`
      <h1>${recipe.title}</h1>
      ${raw(content)}
      <p>
        Kategori:
        <a href="/kategorier/${categorySlug}">${recipe.category}</a><br />
      </p>
      <a href="/">Start</a>
    `;
    const page = layout(recipe.title, output);
    return c.html(page);
  });
  Deno.serve({ port: 8000 }, app.fetch);
};

bootstrap();
