/**
 * File System Mock
 * Mock implementation of fs/promises for testing
 */

import type * as fs from 'fs/promises';

export interface MockFile {
  content: string | Buffer;
  encoding?: BufferEncoding;
}

export interface MockDir {
  [key: string]: MockFile | MockDir;
}

export class MockFileSystem {
  private root: Map<string, MockFile | MockDir> = new Map();
  private directories: Set<string> = new Set();

  /**
   * Reset the mock file system
   */
  reset(): void {
    this.root.clear();
    this.directories.clear();
    this.directories.add(''); // Root directory
  }

  /**
   * Normalize path
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/$/, '');
  }

  /**
   * Get directory and file name from path
   */
  private splitPath(filePath: string): { dir: string; name: string } {
    const normalized = this.normalizePath(filePath);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) {
      return { dir: '', name: normalized };
    }
    return {
      dir: normalized.slice(0, lastSlash),
      name: normalized.slice(lastSlash + 1),
    };
  }

  /**
   * Get nested value from root
   */
  private getValue(path: string): MockFile | MockDir | undefined {
    const parts = this.normalizePath(path).split('/').filter(Boolean);
    let current: MockFile | MockDir | undefined = Object.fromEntries(this.root);

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }
      current = (current as MockDir)[part];
    }

    return current;
  }

  /**
   * Set nested value in root
   */
  private setValue(path: string, value: MockFile | MockDir): void {
    const parts = this.normalizePath(path).split('/').filter(Boolean);
    
    if (parts.length === 0) {
      throw new Error('Cannot set root value');
    }

    let current = this.root;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.has(part)) {
        current.set(part, {});
      }
      const next = current.get(part);
      if (typeof next !== 'object' || next === null || 'content' in next) {
        throw new Error(`ENOTDIR: ${parts.slice(0, i + 1).join('/')}`);
      }
      current = new Map(Object.entries(next as MockDir));
    }

    current.set(parts[parts.length - 1], value);
  }

  /**
   * Check if path exists
   */
  async access(filePath: string, mode?: number): Promise<void> {
    const value = this.getValue(filePath);
    if (value === undefined) {
      const error = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }
  }

  /**
   * Check if path exists (sync version)
   */
  accessSync(filePath: string, mode?: number): void {
    const value = this.getValue(filePath);
    if (value === undefined) {
      const error = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }
  }

  /**
   * Read file
   */
  async readFile(filePath: string, options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<string | Buffer> {
    await this.access(filePath);
    const value = this.getValue(filePath);
    
    if (value === undefined || !('content' in value)) {
      const error = new Error(`EISDIR: illegal operation on a directory, read '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'EISDIR';
      throw error;
    }

    const encoding = typeof options === 'string' ? options : options?.encoding;
    
    if (encoding === 'utf-8' || encoding === 'utf8') {
      if (Buffer.isBuffer(value.content)) {
        return value.content.toString('utf-8');
      }
      return value.content as string;
    }

    if (Buffer.isBuffer(value.content)) {
      return value.content;
    }
    return Buffer.from(value.content as string);
  }

  /**
   * Write file
   */
  async writeFile(filePath: string, data: string | Buffer, options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<void> {
    const { dir } = this.splitPath(filePath);
    
    if (dir && !this.directories.has(dir) && !this.getValue(dir)) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }

    const encoding = typeof options === 'string' ? options : options?.encoding;
    
    this.setValue(filePath, {
      content: data,
      encoding: encoding as BufferEncoding,
    });
  }

  /**
   * Create directory
   */
  async mkdir(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalizePath(filePath);
    
    if (options?.recursive) {
      const parts = normalized.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        this.directories.add(current);
      }
    } else {
      const { dir, name } = this.splitPath(normalized);
      
      if (dir && !this.directories.has(dir)) {
        const error = new Error(`ENOENT: no such file or directory, mkdir '${filePath}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      
      this.directories.add(normalized);
    }
  }

  /**
   * Read directory
   */
  async readdir(filePath: string, options?: { withFileTypes?: boolean }): Promise<string[] | fs.Dirent[]> {
    await this.access(filePath);
    
    const value = this.getValue(filePath);
    if (value === undefined || 'content' in value) {
      const error = new Error(`ENOTDIR: not a directory, scandir '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'ENOTDIR';
      throw error;
    }

    const entries = Object.keys(value as MockDir);
    
    if (options?.withFileTypes) {
      return entries.map(name => {
        const entryValue = (value as MockDir)[name];
        const isDirectory = !('content' in entryValue);
        
        return {
          name,
          isDirectory: () => isDirectory,
          isFile: () => !isDirectory,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        } as fs.Dirent;
      });
    }

    return entries;
  }

  /**
   * Delete file
   */
  async unlink(filePath: string): Promise<void> {
    await this.access(filePath);
    
    const value = this.getValue(filePath);
    if (value && !('content' in value)) {
      const error = new Error(`EISDIR: illegal operation on a directory, unlink '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'EISDIR';
      throw error;
    }

    const { dir, name } = this.splitPath(filePath);
    const parent = this.getValue(dir) as MockDir;
    if (parent) {
      delete parent[name];
    }
  }

  /**
   * Remove directory
   */
  async rmdir(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const normalized = this.normalizePath(filePath);
      
      // Remove all nested directories and files
      for (const dir of Array.from(this.directories)) {
        if (dir.startsWith(normalized)) {
          this.directories.delete(dir);
        }
      }
      
      // Remove from parent
      const { dir, name } = this.splitPath(normalized);
      const parent = this.getValue(dir) as MockDir;
      if (parent) {
        delete parent[name];
      }
      
      return;
    }

    await this.access(filePath);
    
    const value = this.getValue(filePath);
    if (value && 'content' in value) {
      const error = new Error(`ENOTDIR: not a directory, rmdir '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'ENOTDIR';
      throw error;
    }

    const entries = value ? Object.keys(value as MockDir) : [];
    if (entries.length > 0) {
      const error = new Error(`ENOTEMPTY: directory not empty, rmdir '${filePath}'`);
      (error as NodeJS.ErrnoException).code = 'ENOTEMPTY';
      throw error;
    }

    const { dir, name } = this.splitPath(filePath);
    const parent = this.getValue(dir) as MockDir;
    if (parent) {
      delete parent[name];
    }
    this.directories.delete(this.normalizePath(filePath));
  }

  /**
   * Check if file exists (using stat)
   */
  async stat(filePath: string): Promise<fs.Stats> {
    await this.access(filePath);
    
    const value = this.getValue(filePath);
    const isDirectory = value !== undefined && !('content' in value);
    
    return {
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      size: isDirectory ? 0 : (value as MockFile)?.content?.length ?? 0,
      atime: new Date(),
      mtime: new Date(),
      ctime: new Date(),
      birthtime: new Date(),
    } as fs.Stats;
  }

  /**
   * Setup mock filesystem structure
   */
  setup(structure: MockDir, basePath: string = ''): void {
    const setupRecursive = (obj: MockDir, currentPath: string) => {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = currentPath ? `${currentPath}/${key}` : key;
        
        if ('content' in value) {
          this.setValue(fullPath, value as MockFile);
        } else {
          this.directories.add(fullPath);
          setupRecursive(value as MockDir, fullPath);
        }
      }
    };

    setupRecursive(structure, basePath);
  }

  /**
   * Get all files as object (for debugging)
   */
  getStructure(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of this.root) {
      result[key] = value;
    }
    
    return result;
  }

  /**
   * List all directories
   */
  getDirectories(): string[] {
    return Array.from(this.directories);
  }
}

// Global mock instance
export const mockFs = new MockFileSystem();

/**
 * Create vi mock for fs/promises
 */
export function createFsMock(): typeof fs {
  return {
    access: (path: string, mode?: number) => mockFs.access(path, mode),
    readFile: (path: string, options?: { encoding?: BufferEncoding } | BufferEncoding) => 
      mockFs.readFile(path, options) as Promise<string>,
    writeFile: (path: string, data: string | Buffer, options?: { encoding?: BufferEncoding } | BufferEncoding) => 
      mockFs.writeFile(path, data, options),
    mkdir: (path: string, options?: { recursive?: boolean }) => mockFs.mkdir(path, options),
    readdir: (path: string, options?: { withFileTypes?: boolean }) => mockFs.readdir(path, options) as Promise<string[]>,
    unlink: (path: string) => mockFs.unlink(path),
    rmdir: (path: string, options?: { recursive?: boolean }) => mockFs.rmdir(path, options),
    stat: (path: string) => mockFs.stat(path),
    lstat: (path: string) => mockFs.stat(path),
    cp: () => Promise.resolve(),
    rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => 
      mockFs.rmdir(path, { recursive: options?.recursive }),
  } as typeof fs;
}
