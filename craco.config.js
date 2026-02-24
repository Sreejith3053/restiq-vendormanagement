// craco.config.js
export const reactScriptsVersion = "react-scripts";
export const devServer = {
    allowedHosts: 'all',
};

export const webpack = {
    configure: (webpackConfig) => {
        const sourceMapLoader = webpackConfig.module.rules.find(
            (rule) => rule.enforce === 'pre' &&
                rule.use && rule.use.some &&
                rule.use.some((u) => u.loader && u.loader.includes('source-map-loader'))
        );
        if (sourceMapLoader) {
            sourceMapLoader.exclude = [
                ...(sourceMapLoader.exclude || []),
                /node_modules\/react-datepicker/,
            ];
        }
        return webpackConfig;
    },
};
