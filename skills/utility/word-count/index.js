'use strict';

module.exports = async function wordCount({ text }) {
  if (typeof text !== 'string') throw new Error("Input 'text' must be a string");

  const charCount = text.length;
  const charCountNoSpaces = text.replace(/\s/g, '').length;
  const words = text.trim() === '' ? [] : text.trim().split(/\s+/);
  const wordCount = words.length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length;

  return { wordCount, sentenceCount, charCount, charCountNoSpaces };
};
