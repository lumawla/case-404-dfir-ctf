import { ChevronDown, ChevronRight, FileImage, FileText } from "lucide-react";
import { useState } from "react";
import type { DirNode, FileNode, Node } from "./vfs";

const byName = (a: Node, b: Node) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);

function Dir({ node, onOpen, depth }: { node: DirNode; onOpen: (f: FileNode) => void; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  // Like a normal file manager: dotfiles are not shown.
  const kids = [...node.children.values()].filter((k) => !k.name.startsWith(".")).sort(byName);
  return (
    <li className="is-dir">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        {node.name}/
      </button>
      {open && (
        <ul>
          {kids.map((k) =>
            k.type === "dir" ? (
              <Dir key={k.name} node={k} onOpen={onOpen} depth={depth + 1} />
            ) : (
              <li key={k.name}>
                <button type="button" onClick={() => onOpen(k)} title={`Open ${k.name} in the terminal`}>
                  {/\.(jpe?g|png|svg|pdf)$/i.test(k.name) ? <FileImage aria-hidden="true" /> : <FileText aria-hidden="true" />}
                  {k.name}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ root, onOpen, hidden }: { root: Node | null; onOpen: (f: FileNode) => void; hidden: boolean }) {
  if (!root || root.type !== "dir") return null;
  return (
    <nav className="filetree" aria-label="Evidence files" hidden={hidden}>
      <ul>
        <Dir node={root} onOpen={onOpen} depth={0} />
      </ul>
    </nav>
  );
}
