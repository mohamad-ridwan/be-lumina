const customHeader = (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Credential", "true");
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, Authorization, X-Requested-With, Content-Type"
    );
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    next();
};

module.exports = { customHeader };
