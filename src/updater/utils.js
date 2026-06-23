function newUrlFromBase(pathname, baseUrl) {
  const result = new URL(pathname, baseUrl);
  return result.href;
}

module.exports = { newUrlFromBase };
