# Specta design workflow

Create one reviewable Technical Design for the requested Epic.

- Read Architecture, the target Epic, and the available project profiles.
- Select one existing project or explicitly propose a new project target.
- For a blank target, declare the language, framework, and toolchain. Specta currently supports only the TypeScript language adapter.
- Treat frameworks such as Next.js, Angular, NestJS, Express, and React as project-profile metadata, not adapters.
- Declare every module, workspace-relative file path, export, and public signature before scaffolding.
- For every module, copy the exact Architecture component labels it implements into `architectureComponents`. Map only components touched by this Epic; one Epic is not required to implement the entire architecture.
- Reference earlier-Epic designs, files, and symbols with exact structured dependency references.
- Do not claim dependency status; Specta resolves it deterministically.
- Do not write source files during this workflow.

Submit only the JSON Technical Design draft expected by the CLI helper.
