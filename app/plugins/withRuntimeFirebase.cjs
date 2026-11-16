const { withMainApplication } = require("expo/config-plugins");

module.exports = (config) =>
  withMainApplication(config, (config) => {
    const call = "expo.modules.omnixfirebase.RuntimeFirebase.restore(this)";
    let source = config.modResults.contents;
    if (!source.includes(call)) {
      const java = config.modResults.language === "java";
      const anchor = java ? "super.onCreate();" : "super.onCreate()";
      if (!source.includes(anchor))
        throw new Error(
          "Could not locate Application startup for Firebase restoration"
        );
      source = source.replace(
        anchor,
        `${anchor}\n    ${call}${java ? ";" : ""}`
      );
      config.modResults.contents = source;
    }
    return config;
  });
