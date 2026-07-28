import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/tools/tool.js';
import type { Tool, ToolContext, ToolResult } from '../../../src/types.js';

function makeMockTool(name: string): Tool {
  return {
    name,
    description: `Mock tool ${name}`,
    parameters: {},
    async execute(_params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      return { success: true, duration_ms: 0 };
    },
  };
}

describe('ToolRegistry', () => {
  it('register and get a tool', () => {
    const registry = new ToolRegistry();
    const tool = makeMockTool('test_tool');
    registry.register(tool);
    expect(registry.get('test_tool')).toBe(tool);
  });

  it('get returns undefined for unregistered tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('names returns all registered tool names', () => {
    const registry = new ToolRegistry();
    registry.register(makeMockTool('tool_a'));
    registry.register(makeMockTool('tool_b'));
    expect(registry.names()).toEqual(['tool_a', 'tool_b']);
  });

  it('list returns all registered tools', () => {
    const registry = new ToolRegistry();
    const toolA = makeMockTool('tool_a');
    const toolB = makeMockTool('tool_b');
    registry.register(toolA);
    registry.register(toolB);
    expect(registry.list()).toEqual([toolA, toolB]);
  });

  it('register twice with same name overwrites', () => {
    const registry = new ToolRegistry();
    const tool1 = makeMockTool('dup');
    const tool2 = makeMockTool('dup');
    registry.register(tool1);
    registry.register(tool2);
    expect(registry.get('dup')).toBe(tool2);
    expect(registry.names()).toEqual(['dup']);
  });
});
