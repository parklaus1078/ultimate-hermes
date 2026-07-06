export function hermesTitleProperty(title: string): Record<string, unknown> {
  return {
    title: {
      title: [{ text: { content: title } }]
    }
  };
}
