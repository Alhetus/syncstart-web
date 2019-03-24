module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "plugins": ["prettier"],
    "extends": ["eslint:recommended", "prettier"],
    "rules": {
        "no-console": "off",
        "prettier/prettier": "error"
    }
};
