import {Component, computed, inject, input, linkedSignal} from '@angular/core';
import {LlmResponseFile} from '../../../../../runner/shared-interfaces';
import {CodeViewer} from '../code-viewer';
import {Clipboard} from '@angular/cdk/clipboard';
import {FileTreeNode, TreeNode, buildFileTree} from './file-tree';

@Component({
  selector: 'app-file-code-viewer',
  templateUrl: './file-code-viewer.html',
  styleUrl: './file-code-viewer.scss',
  imports: [CodeViewer],
})
export class FileCodeViewer {
  private readonly clipboard = inject(Clipboard);
  readonly files = input.required<LlmResponseFile[]>();

  private readonly fileTree = computed(() => buildFileTree(this.files()));

  readonly flatTree = computed(() => {
    const tree = this.fileTree();
    const flatten = (nodes: TreeNode[]): TreeNode[] => {
      let flat: TreeNode[] = [];
      for (const node of nodes) {
        flat.push(node);
        if (node.isDirectory) {
          flat = flat.concat(flatten(node.children));
        }
      }
      return flat;
    };
    return flatten(tree);
  });

  readonly selectedFile = linkedSignal<FileTreeNode | undefined>(() =>
    this.flatTree().find(f => !f.isDirectory),
  );

  toggleNode(node: TreeNode): void {
    if (node.isDirectory) {
      node.isExpanded.update(e => !e);
    } else {
      this.selectedFile.set(node);
    }
  }

  copyCode(): void {
    const fileNode = this.selectedFile();
    if (fileNode?.file) {
      if (!this.clipboard.copy(fileNode.file.code)) {
        alert('Failed to copy code to clipboard.');
      }
    }
  }

  getFileIcon(filePath: string, options: {isDirectory: boolean; isExpanded?: boolean}): string {
    if (options.isDirectory) {
      return options.isExpanded ? 'folder_open' : 'folder';
    }
    const extension = filePath.split('.').pop();
    switch (extension) {
      case 'html':
        return 'html';
      case 'ts':
        return 'javascript';
      case 'css':
        return 'css';
      case 'scss':
        return 'css';
      default:
        return 'article';
    }
  }

  isNodeVisible(node: TreeNode): boolean {
    let current = node.parent;
    while (current && current.path) {
      if (!current.isExpanded()) {
        return false;
      }
      current = current.parent;
    }
    return true;
  }
}
