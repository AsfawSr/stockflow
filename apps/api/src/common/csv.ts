// Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF line ends.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let sawField = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      sawField = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      sawField = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      if (sawField || field !== '') {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
      sawField = false;
    } else {
      field += char;
      sawField = true;
    }
  }
  if (quoted) throw new Error('Unterminated quoted field.');
  if (sawField || field !== '') {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
