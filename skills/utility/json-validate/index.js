'use strict';

module.exports = async function jsonValidate({ text }) {
  if (typeof text !== 'string') throw new Error("Input 'text' must be a string");

  try {
    const parsed = JSON.parse(text);
    return { valid: true, parsed };
  } catch (e) {
    return { valid: false, error: e.message };
  }
};
