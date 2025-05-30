import { walk } from "jsr:@std/fs/walk";
import { extractYaml } from "jsr:@std/front-matter";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { logger } from "hono/logger";
import { appendTrailingSlash } from "hono/trailing-slash";
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
    return { title, category: category?.toLowerCase(), body, source };
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

let recipes: Recipe[] = [];

const uppercaseFirst = (input: string): string => {
  const first = input.slice(0, 1);
  const rest = input.slice(1);
  return first.toUpperCase() + rest;
};

const formatSource = (source: string): string => {
  if (source.includes("https://")) {
    return html`<a href="${source}">${source}</a>`();
  }
  return source;
};

const bootstrap = async () => {
  recipes = await getRecipes();

  const layout = (title: string, children: ReturnType<typeof html>) => {
    return html` <!DOCTYPE html>
      <html>
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
    html`Hoppsan, sidan finns inte`,
  );

  const app = new Hono();
  app.use(compress()).use(appendTrailingSlash()).use(logger());

  app.get("/", (c) => {
    const sortedRecipes = [...recipes].sort((a, b) =>
      a.title < b.title ? -1 : 1,
    );
    const output = html`<h1>Recept</h1>
      <ul>
        ${sortedRecipes.map(
          (recipe) =>
            html`<li>
              <a href="/recept/${recipe.slug}">${recipe.title}</a>
            </li>`,
        )}
      </ul>`;
    const page = layout("Start", output);
    return c.html(page);
  });

  app.get("/kategorier", (c) => {
    const allCategories = recipes.map((recipe) => recipe.category);
    const uniqueCategories = [...new Set(allCategories)];
    const getNumberOfEntriesByCategory = (category: string) =>
      recipes.filter((recipe) => recipe.category === category).length;
    if (!uniqueCategories.length) {
      return c.html(notFoundPage, 404);
    }

    const output = html`
      <h1>Kategorier</h1>
      <ul>
        ${uniqueCategories.map((category) => {
          const sum = getNumberOfEntriesByCategory(category);
          return html`<li>
            <a href="/kategorier/${category}">${uppercaseFirst(category)}</a>
            (${sum})
          </li>`;
        })}
      </ul>
      <a href="/">Start</a>
    `;
    const page = layout("Kategorier", output);
    return c.html(page);
  });

  app.get("/kategorier/:category", (c) => {
    const requestedCategory = c.req.param("category");
    const recipesOfCategory = recipes
      .filter((recipe) => recipe.category === requestedCategory)
      .toSorted((a, b) => (a.title < b.title ? -1 : 1));
    if (!recipesOfCategory.length) {
      return c.html(notFoundPage, 404);
    }

    const output = html`
      <h1>Recept med kategori ${requestedCategory}</h1>
      <ul>
        ${recipesOfCategory.map(
          (recipe) =>
            html`<li>
              <a href="/recept/${recipe.slug}">${recipe.title}</a>
            </li>`,
        )}
      </ul>
      <a href="/">Start</a>
    `;

    const readableCategory = uppercaseFirst(requestedCategory);
    const page = layout(readableCategory, output);
    return c.html(page);
  });

  app.use("/recept/*", etag());

  app.get("/recept/:slug", async (c) => {
    const slug = c.req.param("slug");
    const recipe = recipes.find((recipe) => recipe.slug === slug);
    if (!recipe) {
      return c.html(notFoundPage, 404);
    }
    const content = await Renderer.render(recipe.content);
    const categorySlug = recipe.category.toLowerCase();
    const readableCategory = uppercaseFirst(recipe.category);
    const formattedSource = formatSource(recipe.source);
    const output = html`
      <h1>${recipe.title}</h1>
      ${raw(content)}
        <dl><td>Kategori</dt><dd><a href="/kategorier/${categorySlug}">${readableCategory}</a></dd>
          <dt>Källa</dt><dd>${raw(formattedSource)}</dd>
        </dl>
      <a href="/">&laquo; Start</a>
    `;
    const page = layout(recipe.title, output);
    return c.html(page);
  });
  Deno.serve({ port: 8000 }, app.fetch);
};

bootstrap();
