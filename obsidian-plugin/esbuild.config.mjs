import esbuild from "esbuild";

const prod = process.argv[2] !== "--watch";

const context = await esbuild.context({
  banner: {
    js: "/* Lexicon Obsidian plugin */"
  },
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
