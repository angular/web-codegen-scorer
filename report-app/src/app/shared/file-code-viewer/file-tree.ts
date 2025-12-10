import {signal, WritableSignal} from '@angular/core';
import {LlmResponseFile} from '../../../../../runner/shared-interfaces';

export interface DirectoryTreeNode {
  isDirectory: true;
  name: string;
  path: string;
  isExpanded: WritableSignal<boolean>;
  children: (FileTreeNode | DirectoryTreeNode)[];
  depth: number;
  parent?: DirectoryTreeNode;
}

export interface FileTreeNode {
  isDirectory: false;
  name: string;
  path: string;
  file: LlmResponseFile;
  depth: number;
  parent?: DirectoryTreeNode;
}

export type TreeNode = FileTreeNode | DirectoryTreeNode;

/** Creates a directory tree node. */
function createDirectoryNode(
  name: string,
  path: string,
  depth: number,
  parent: DirectoryTreeNode | undefined,
): DirectoryTreeNode {
  return {
    isDirectory: true,
    name,
    path,
    isExpanded: signal(true),
    children: [],
    depth,
    parent,
  };
}

/** Creates a file tree node. */
function createFileNode(
  name: string,
  path: string,
  depth: number,
  parent: DirectoryTreeNode | undefined,
  file: LlmResponseFile,
): FileTreeNode {
  return {
    isDirectory: false,
    name,
    path,
    depth,
    parent,
    file,
  };
}

/** Recursively sorts the tree, directories first, then alphabetically. */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  nodes.forEach(node => {
    if (node.isDirectory) {
      sortTree(node.children);
    }
  });
}

/** Ensures all parent directories for a given path exist in the tree. */
function ensureDirectoryPath(pathParts: string[], nodeMap: Map<string, TreeNode>): void {
  let currentPath = '';
  let parentNode = nodeMap.get('')!; // Start from root

  for (const part of pathParts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    if (!nodeMap.has(currentPath)) {
      assertIsDirectory(parentNode, 'Expected parent node to be a directory.');
      const newNode = createDirectoryNode(part, currentPath, parentNode.depth + 1, parentNode);
      parentNode.children.push(newNode);
      nodeMap.set(currentPath, newNode);
    }
    parentNode = nodeMap.get(currentPath)!;
  }
}

/** Builds the file tree from a flat list of files. */
export function buildFileTree(files: LlmResponseFile[]): TreeNode[] {
  const root = createDirectoryNode('root', '', -1, undefined);
  const nodeMap = new Map<string, TreeNode>([['', root]]);

  for (const file of files) {
    const pathParts = file.filePath.split('/');
    const fileName = pathParts.pop()!;
    const directoryPath = pathParts.join('/');

    ensureDirectoryPath(pathParts, nodeMap);

    const parentNode = nodeMap.get(directoryPath)!;
    assertIsDirectory(parentNode, 'Expected parent node to be a directory.');

    const fileNode = createFileNode(
      fileName,
      file.filePath,
      parentNode.depth + 1,
      parentNode,
      file,
    );
    parentNode.children.push(fileNode);
  }

  sortTree(root.children);
  return root.children;
}

function assertIsDirectory(n: TreeNode, failureMessage: string): asserts n is DirectoryTreeNode {
  if (!n.isDirectory) {
    throw new Error(failureMessage);
  }
}
