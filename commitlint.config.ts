export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // New feature
        "fix", // Fix bug
        "docs", // Documentation changes
        "style", // Code style changes (formatting, missing semi colons, etc)
        "refactor", // Code refactoring
        "perf", // Performance improvements
        "test", // Adding tests
        "chore", // Changes to build process or auxiliary tools
        "revert", // Revert changes
        "build", // Changes to build system or external dependencies
        "ci", // Changes to CI configuration files and scripts
      ],
    ],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "scope-case": [2, "always", "lower-case"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
  },
};
