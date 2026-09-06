/// A tokeniser for Windows batch files, written here because nothing ships one.
///
/// Every other language in the catalogue is a Lezer grammar or one of CodeMirror's legacy stream
/// modes. `.bat` and `.cmd` are neither: there is no batch mode in `@codemirror/legacy-modes`, and a
/// file type with no colouring at all would fail the one thing the file-types spec asks of a type.
/// So this is rules for `simpleMode`, which is the same machinery the legacy modes are built on.
///
/// **Rules as data, with no CodeMirror import.** The loader combines these with `simpleMode`, which
/// keeps this module free of the grammar packages the module-graph guard is about, and lets the
/// rules be read and tested as what they are: an ordered list, first match wins.
///
/// The token names are CodeMirror 5's, because that is what `simpleMode` speaks. `StreamLanguage`
/// maps them to tags, and `editorTheme` maps tags to this app's roles - so the vocabulary here is
/// chosen for what it MEANS, and the shell and PowerShell modes beside it use the same words for the
/// same things.
export const BATCH_RULES = {
  start: [
    // Both spellings of a comment. Anchored to the line, because `rem` is a comment only where a
    // command may start: `echo rem this` is text, and colouring it would hide half of what it says.
    //
    // `::` is really a label that can never be jumped to, which is exactly why it reads as a
    // comment. Two things keep it one - this rule comes first, and the label rule below is
    // written so it cannot claim a second colon. Either alone is enough; both are here because
    // which one somebody would remove while tidying is not predictable.
    { sol: true, regex: /\s*(?:::|@?rem\b)[^\r\n]*/i, token: "comment" },

    // A label, and so the target of every `goto` and `call` in the file - the thing you scan a batch
    // script for when trying to follow it. See the note above on why the class excludes a colon.
    { sol: true, regex: /\s*:[^\s:=][^\r\n]*/, token: "atom" },

    // No escapes and no continuation: a batch string ends at the next quote or at the end of the
    // line, and an unterminated one is coloured to the line end rather than swallowing the file.
    { regex: /"[^"\r\n]*"?/, token: "string" },

    // `%VAR%`, `%1`, `%~dp0`, and `!VAR!` under delayed expansion. `attribute` rather than `def`,
    // which is what shell uses for `$var`: a batch file is mostly variable expansion, and this app
    // gives `attributeName` to the thing worth picking out of a configuration file. Here that is
    // this.
    { regex: /%(?:[*~\d][^\s%]*|[^\s%\r\n]+%?)|![^\s!\r\n]+!/, token: "attribute" },

    // Control flow and the comparison operators that go with `if`.
    {
      regex:
        /\b(?:if|else|for|in|do|goto|call|exit|set|setlocal|endlocal|shift|not|exist|defined|errorlevel|equ|neq|lss|leq|gtr|geq)\b/i,
      token: "keyword",
    },

    // The commands `cmd.exe` carries itself, and the handful of external ones a script reaches for
    // often enough to be worth recognising. `builtin`, the same word shell uses for `cd` and `echo`.
    {
      regex:
        /\b(?:echo|cd|chdir|pushd|popd|copy|xcopy|robocopy|move|ren|rename|del|erase|dir|md|mkdir|rd|rmdir|type|start|pause|title|cls|find|findstr|sort|more|attrib|assoc|ftype|where|tasklist|taskkill|timeout|choice|ping|reg|sc|net|schtasks|powershell|cmd)\b/i,
      token: "builtin",
    },

    { regex: /\b\d+\b/, token: "number" },

    // `@` suppresses echo, the rest are redirection and chaining. `&&` and `||` first, or they would
    // be read as two single characters.
    { regex: /&&|\|\||[@|&<>^()]/, token: "operator" },
  ],
  languageData: {
    name: "batch",
    // What the editor would write to comment a line out. `REM` rather than `::`, because it is the
    // one that is a comment everywhere rather than a label that happens to read as one.
    commentTokens: { line: "REM" },
  },
};
