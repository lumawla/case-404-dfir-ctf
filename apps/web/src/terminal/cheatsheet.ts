// The beginner's cheat sheet: what each tool is for, with generic examples. It teaches tools, not the
// case, so examples use made-up file names. `help <command>` prints the same examples.

export type CheatEntry = { cmd: string; what: string; examples: [string, string][] };
export type CheatSection = { title: string; intro?: string; entries: CheatEntry[] };

export const CHEATSHEET: CheatSection[] = [
  {
    title: "Getting around",
    intro: "~ is your home folder. Paths are relative to where you are unless they start with / or ~. Tab completes names; the up arrow brings back earlier commands.",
    entries: [
      { cmd: "ls", what: "List what's in a folder", examples: [["ls", "this folder"], ["ls -la", "everything, with sizes and dates, including hidden files (names starting with a dot)"], ["ls -lt photos", "newest first"]] },
      { cmd: "cd", what: "Go into a folder", examples: [["cd reports", "go into reports"], ["cd ..", "up one level"], ["cd ~", "back home"]] },
      { cmd: "pwd", what: "Show where you are", examples: [["pwd", "print the current folder"]] },
      { cmd: "tree", what: "Draw a folder and everything under it", examples: [["tree", "this folder"], ["tree -a", "including hidden files"], ["tree -L 2", "only two levels deep"]] },
      { cmd: "find", what: "Search for files by name or type", examples: [["find . -name '*.csv'", "every CSV file below here"], ["find . -iname '*report*'", "names containing 'report', any case"], ["find . -type d", "folders only"]] },
    ],
  },
  {
    title: "Reading files",
    entries: [
      { cmd: "cat", what: "Print a whole file", examples: [["cat notes.txt", "print it"], ["cat -n notes.txt", "with line numbers"]] },
      { cmd: "head", what: "The first lines", examples: [["head data.csv", "first 10 lines"], ["head -n 3 data.csv", "first 3"]] },
      { cmd: "tail", what: "The last lines", examples: [["tail data.csv", "last 10 lines"], ["tail -n +2 data.csv", "everything except the first line"]] },
      { cmd: "grep", what: "Find lines that contain something", examples: [["grep error app.log", "lines containing 'error'"], ["grep -i error app.log", "ignore upper/lower case"], ["grep -n 'Room 4' *.txt", "with file names and line numbers"], ["grep -r password .", "search every file below here"], ["grep -C 2 alarm app.log", "with 2 lines of context around each match"]] },
      { cmd: "wc", what: "Count lines, words and bytes", examples: [["wc -l data.csv", "how many lines"]] },
      { cmd: "open", what: "View an image or a PDF", examples: [["open photo.jpg", "shows the picture"], ["open invoice.pdf", "opens it in a new tab"]] },
      { cmd: "download", what: "Save a copy to your own computer", examples: [["download photo.jpg", "for a closer look in your own tools"]] },
    ],
  },
  {
    title: "Tables (CSV) and JSON",
    intro: "A CSV file is a table: one row per line, columns separated by commas. JSON is structured data in { } and [ ].",
    entries: [
      { cmd: "column", what: "Line up a CSV so it's readable", examples: [["column -t -s, data.csv", "align the columns"]] },
      { cmd: "cut", what: "Keep only some columns", examples: [["cut -d, -f1,3 data.csv", "columns 1 and 3"]] },
      { cmd: "sort", what: "Sort lines", examples: [["sort names.txt", "A to Z"], ["sort -t, -k2 data.csv", "by the second column"], ["sort -rn counts.txt", "biggest number first"]] },
      { cmd: "uniq", what: "Collapse repeated lines (sort first)", examples: [["sort names.txt | uniq -c", "how many times each line appears"]] },
      { cmd: "awk", what: "Pick rows and columns with conditions", examples: [["awk -F, '$3 > 100' data.csv", "rows where column 3 is over 100"], ["awk -F, '{print $1, $4}' data.csv", "print columns 1 and 4"]] },
      { cmd: "jq", what: "Read JSON", examples: [["jq . data.json", "pretty-print it"], ["jq '.items[].name' data.json", "one field from every item"], ["jq '.items[] | select(.from == \"ANNA\")' data.json", "only the items that match"]] },
    ],
  },
  {
    title: "Comparing files and proving they're unchanged",
    intro: "A hash is a file's fingerprint. Change a single character and the hash changes completely. If two files have the same hash, they are the same file.",
    entries: [
      { cmd: "sha256sum", what: "Fingerprint files", examples: [["sha256sum report.csv", "print its SHA-256 hash"], ["sha256sum *.csv", "hash several files to compare them"], ["sha256sum -c sums.txt", "check files against a list of recorded hashes"]] },
      { cmd: "diff", what: "Show the lines that differ between two files", examples: [["diff old.csv new.csv", "only the lines that changed"], ["diff -u old.csv new.csv", "with a little context"]] },
      { cmd: "cmp", what: "Find the first byte where two files differ", examples: [["cmp a.bin b.bin", "silent when they are identical"]] },
    ],
  },
  {
    title: "Metadata and hidden data",
    intro: "Files carry information you can't see when you open them: when a photo was taken, which device made it, what program saved it.",
    entries: [
      { cmd: "file", what: "What kind of file is this, really?", examples: [["file mystery.dat", "identifies it from its contents, not its name"]] },
      { cmd: "exiftool", what: "Read a file's metadata", examples: [["exiftool photo.jpg", "all of it: camera, dates, sizes"], ["exiftool -DateTimeOriginal photo.jpg", "just one tag"], ["exiftool -alldates photo.jpg", "every date tag"]] },
      { cmd: "strings", what: "Pull readable text out of any file", examples: [["strings app.bin", "every run of 4+ readable characters"], ["strings -n 10 app.bin | grep -i key", "longer runs only, then search them"]] },
      { cmd: "xxd", what: "Look at the raw bytes", examples: [["xxd -l 64 photo.jpg", "the first 64 bytes in hex"]] },
      { cmd: "sqlite3", what: "Query a SQLite database (many apps store data this way)", examples: [["sqlite3 app.db .tables", "list its tables"], ["sqlite3 app.db .schema", "show how the tables are defined"], ["sqlite3 -header app.db \"SELECT * FROM users\"", "every row of a table"], ["sqlite3 app.db \"SELECT name FROM users WHERE id = 3\"", "only matching rows"]] },
    ],
  },
  {
    title: "Encodings and ciphers",
    entries: [
      { cmd: "base64", what: "Decode Base64 (text made of A–Z, a–z, 0–9, + and /)", examples: [["echo SGVsbG8= | base64 -d", "prints Hello"]] },
      { cmd: "tr", what: "Swap characters, e.g. to undo a Caesar shift", examples: [["echo Khoor | tr 'D-ZA-Cd-za-c' 'A-Za-z'", "shifts back by 3: Hello"]] },
      { cmd: "Caesar Lab", what: "The Caesar Lab tab shifts text by any amount, so you can try shifts quickly", examples: [] },
    ],
  },
  {
    title: "Combining commands",
    entries: [
      { cmd: "|", what: "Send one command's output into the next", examples: [["grep ERROR app.log | wc -l", "count the error lines"], ["cut -d, -f2 data.csv | sort | uniq -c", "count each value in column 2"]] },
      { cmd: ">", what: "Save output to a file in /tmp (your scratch space)", examples: [["grep ERROR app.log > /tmp/errors.txt", "write it"], ["echo note >> /tmp/notes.txt", "add to the end"]] },
      { cmd: "help", what: "Every command, and the options of one", examples: [["help", "list all commands"], ["help grep", "options and examples for grep"]] },
    ],
  },
];

/** Examples for `help <command>`. */
export function examplesFor(cmd: string): [string, string][] {
  for (const section of CHEATSHEET) for (const e of section.entries) if (e.cmd === cmd) return e.examples;
  return [];
}
