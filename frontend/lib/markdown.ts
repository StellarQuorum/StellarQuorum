export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*<\/li>)/, "<ul>$1</ul>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/^(.+)$/gm, (match, p1) => {
      if (
        match.startsWith("<h") ||
        match.startsWith("<ul") ||
        match.startsWith("</ul") ||
        match.startsWith("<li") ||
        match.startsWith("</li")
      ) {
        return match;
      }
      return `<p>${match}</p>`;
    });

  return html.replace(/<p><\/p>/g, "");
}
