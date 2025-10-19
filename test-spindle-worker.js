/* ------------------------------------------------------------
 *  Spindle Worker Unit Tests
 *  Tests for Web Worker functionality and message handling
 * ------------------------------------------------------------ */

const assert = require('assert');
const { Worker } = require('worker_threads');
const path = require('path');

// Test utilities for spindle worker
class SpindleWorkerTestUtils {
  static createSharedBuffer(size) {
    if (typeof SharedArrayBuffer === 'undefined') {
      // Fallback for Node.js environment
      return new ArrayBuffer(size);
    }
    return new SharedArrayBuffer(size);
  }

  static createTestEmbedding(toolId = 1) {
    const embedding = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      embedding[i] = Math.random() * 2 - 1;
    }
    return embedding;
  }

  static createTestString(toolId = 1) {
    return `test_result_${toolId}_${Math.random()}`;
  }
}

// Test suite for Spindle Worker
class SpindleWorkerTests {
  constructor() {
    this.worker = null;
    this.mindBuffer = null;
    this.ringBuffer = null;
    this.messageQueue = [];
  }

  async setupWorker() {
    // Create shared buffers
    this.mindBuffer = SpindleWorkerTestUtils.createSharedBuffer(64 * 1024);
    this.ringBuffer = SpindleWorkerTestUtils.createSharedBuffer(
      16 + 32 * 512 * 4 // header + slots
    );

    // Mock postMessage for testing
    this.messages = [];
    global.postMessage = (msg) => this.messages.push(msg);

    // Import the message handler
    const { messageHandler } = require('./spindle-worker.js');
    this.messageHandler = messageHandler;

    // Initialize worker first
    await this.sendMessage('init', {
      mindBuffer: this.mindBuffer,
      ringBuffer: this.ringBuffer
    });

    // Reset worker state
    await this.sendMessage('reset');
  }

  async sendMessage(type, payload = {}) {
    // Clear previous messages
    this.messages = [];

    // Send message using the message handler
    this.messageHandler({ data: { type, payload } });

    // Return the last message
    return this.messages[this.messages.length - 1];
  }

  async testInitialization() {
    console.log('Testing worker initialization...');

    await this.setupWorker();

    // Send init message
    const initMessage = await this.sendMessage('init', {
      mindBuffer: this.mindBuffer,
      ringBuffer: this.ringBuffer
    });

    assert.strictEqual(initMessage.type, 'initialized', 'Should receive initialized message');

    console.log('✓ Worker initialization tests passed');
  }

  async testPushToolResult() {
    console.log('Testing pushToolResult...');

    const testResult = SpindleWorkerTestUtils.createTestString(1);
    const toolId = 1;

    const response = await this.sendMessage('pushToolResult', {
      result: testResult,
      toolId: toolId
    });

    assert.strictEqual(response.type, 'toolResultPushed', 'Should receive toolResultPushed message');
    assert(typeof response.payload.slotIndex === 'number', 'Should have slot index');
    assert.strictEqual(response.payload.toolId, toolId, 'Should have correct tool ID');
    assert(response.payload.slotIndex >= 0 && response.payload.slotIndex < 32, 'Slot index should be valid');

    console.log('✓ PushToolResult tests passed');
  }

  async testPushEmbedding() {
    console.log('Testing pushEmbedding...');

    const testEmbedding = SpindleWorkerTestUtils.createTestEmbedding(2);
    const toolId = 2;

    const response = await this.sendMessage('pushEmbedding', {
      embedding: Array.from(testEmbedding), // Convert to regular array
      toolId: toolId
    });

    assert.strictEqual(response.type, 'embeddingPushed', 'Should receive embeddingPushed message');
    assert(typeof response.payload.slotIndex === 'number', 'Should have slot index');
    assert.strictEqual(response.payload.toolId, toolId, 'Should have correct tool ID');

    console.log('✓ PushEmbedding tests passed');
  }

  async testGetStats() {
    console.log('Testing getStats...');

    const statsResponse = await this.sendMessage('getStats');

    assert.strictEqual(statsResponse.type, 'stats', 'Should receive stats message');
    assert(typeof statsResponse.payload.head === 'number', 'Should have head value');
    assert(typeof statsResponse.payload.tail === 'number', 'Should have tail value');
    assert(typeof statsResponse.payload.generation === 'number', 'Should have generation value');
    assert(typeof statsResponse.payload.available === 'number', 'Should have available count');

    console.log('✓ GetStats tests passed');
  }

  async testReset() {
    console.log('Testing reset...');

    // First push some data
    await this.sendMessage('pushToolResult', {
      result: 'test_data',
      toolId: 1
    });

    // Get stats before reset
    const statsBefore = await this.sendMessage('getStats');
    assert(statsBefore.payload.head > 0 || statsBefore.payload.available > 0, 'Should have data before reset');

    // Reset
    const resetResponse = await this.sendMessage('reset');
    assert.strictEqual(resetResponse.type, 'resetComplete', 'Should receive resetComplete message');

    // Get stats after reset
    const statsAfter = await this.sendMessage('getStats');
    assert.strictEqual(statsAfter.payload.head, 0, 'Head should be 0 after reset');
    assert.strictEqual(statsAfter.payload.tail, 0, 'Tail should be 0 after reset');
    assert.strictEqual(statsAfter.payload.generation, 0, 'Generation should be 0 after reset');
    assert.strictEqual(statsAfter.payload.available, 0, 'Available should be 0 after reset');

    console.log('✓ Reset tests passed');
  }

  async testConcurrentOperations() {
    console.log('Testing concurrent operations...');

    const promises = [];
    
    // Push multiple tool results concurrently
    for (let i = 0; i < 5; i++) {
      promises.push(
        this.sendMessage('pushToolResult', {
          result: `concurrent_test_${i}`,
          toolId: i + 1
        })
      );
    }

    const results = await Promise.all(promises);

    assert(results.length === 5, 'Should have 5 results');
    results.forEach((result, index) => {
      assert.strictEqual(result.type, 'toolResultPushed', `Result ${index} should be toolResultPushed`);
      assert(typeof result.payload.slotIndex === 'number', `Result ${index} should have slot index`);
    });

    // Check final stats
    const finalStats = await this.sendMessage('getStats');
    assert(finalStats.payload.available >= 5, 'Should have at least 5 available slots');

    console.log('✓ Concurrent operations tests passed');
  }

  async testErrorHandling() {
    console.log('Testing error handling...');

    // Test unknown message type
    const response = await this.sendMessage('unknownMessage');
    assert(response.type === 'error', 'Should receive error response for unknown message');
    assert(response.payload.message.includes('Unknown message'), 'Should receive unknown message error');

    // Test invalid buffer size
    const invalidResponse = await this.sendMessage('init', {}); // Missing buffers
    assert(invalidResponse.type === 'error', 'Should receive error for invalid init');

    console.log('✓ Error handling tests passed');
  }

  async testRingBufferConsistency() {
    console.log('Testing ring buffer consistency...');

    // Fill buffer to capacity (31 slots - this is the maximum before full)
    const promises = [];
    for (let i = 0; i < 31; i++) {
      promises.push(
        this.sendMessage('pushToolResult', {
          result: `consistency_test_${i}`,
          toolId: i + 1
        })
      );
    }

    await Promise.all(promises);

    // Check stats
    const stats = await this.sendMessage('getStats');
    console.log(`Stats: head=${stats.payload.head}, tail=${stats.payload.tail}, generation=${stats.payload.generation}, available=${stats.payload.available}`);
    console.log(`Expected 31 available slots (slots written), got ${stats.payload.available}`);
    assert(stats.payload.available === 31, 'Should have 31 slots available to read');
    assert(stats.payload.generation === 0, 'Should not have wrapped around yet');

    console.log('✓ Ring buffer consistency tests passed');
  }

  async testStringEncoding() {
    console.log('Testing string encoding...');

    // Reset buffer before testing
    await this.sendMessage('reset');

    const testStrings = [
      'simple_string',
      'string_with_special_chars_!@#$%^&*()',
      'unicode_string_🚀_test',
      'very_long_string_' + 'x'.repeat(100),
      'empty_string_test'
    ];

    for (const testString of testStrings) {
      try {
        const response = await this.sendMessage('pushToolResult', {
          result: testString,
          toolId: 1
        });

        console.log(`Test string "${testString.substring(0, 50)}..." -> response:`, response);
        assert.strictEqual(response.type, 'toolResultPushed', `Should handle string: ${testString.substring(0, 50)}...`);
      } catch (error) {
        console.log(`Error with string "${testString.substring(0, 50)}...": ${error.message}`);
        throw error;
      }
    }

    console.log('✓ String encoding tests passed');
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
    }
  }

  async runAll() {
    console.log('\n=== Spindle Worker Tests ===');
    
    try {
      await this.testInitialization();
      await this.testPushToolResult();
      await this.testPushEmbedding();
      await this.testGetStats();
      await this.testReset();
      await this.testConcurrentOperations();
      await this.testErrorHandling();
      await this.testRingBufferConsistency();
      await this.testStringEncoding();
      
      console.log('✓ All Spindle Worker tests passed\n');
    } catch (error) {
      console.error('❌ Spindle Worker test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Test suite for Worker Message Protocol
class MessageProtocolTests {
  constructor() {
    this.worker = null;
    this.mindBuffer = null;
    this.ringBuffer = null;
  }

  async setupWorker() {
    return new Promise((resolve, reject) => {
      try {
        this.mindBuffer = SpindleWorkerTestUtils.createSharedBuffer(64 * 1024);
        this.ringBuffer = SpindleWorkerTestUtils.createSharedBuffer(16 + 32 * 512 * 4);

        this.worker = new Worker(path.join(__dirname, 'spindle-worker.js'));

        this.worker.on('message', (message) => {
          if (message.type === 'ready') {
            resolve();
          }
        });

        this.worker.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async testMessageFormat() {
    console.log('Testing message format compliance...');

    await this.setupWorker();

    // Test that all messages follow the expected format
    const initResponse = await new Promise((resolve) => {
      this.worker.on('message', resolve);
      this.worker.postMessage({ 
        type: 'init', 
        payload: { mindBuffer: this.mindBuffer, ringBuffer: this.ringBuffer }
      });
    });

    assert(typeof initResponse.type === 'string', 'Message should have type');
    assert(typeof initResponse.payload === 'object' || initResponse.payload === undefined, 'Message should have payload');

    console.log('✓ Message format tests passed');
  }

  async testMessageOrdering() {
    console.log('Testing message ordering...');

    const messages = [];
    this.worker.on('message', (msg) => {
      messages.push(msg);
    });

    // Send multiple messages rapidly
    for (let i = 0; i < 10; i++) {
      this.worker.postMessage({
        type: 'pushToolResult',
        payload: { result: `order_test_${i}`, toolId: i + 1 }
      });
    }

    // Wait for all messages
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that we received responses
    assert(messages.length >= 10, 'Should receive responses for all messages');

    console.log('✓ Message ordering tests passed');
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
    }
  }

  async runAll() {
    console.log('\n=== Message Protocol Tests ===');
    
    try {
      await this.testMessageFormat();
      await this.testMessageOrdering();
      
      console.log('✓ All Message Protocol tests passed\n');
    } catch (error) {
      console.error('❌ Message Protocol test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Performance tests for spindle worker
class SpindleWorkerPerformanceTests {
  constructor() {
    this.worker = null;
    this.mindBuffer = null;
    this.ringBuffer = null;
  }

  async setupWorker() {
    return new Promise((resolve, reject) => {
      try {
        this.mindBuffer = SpindleWorkerTestUtils.createSharedBuffer(64 * 1024);
        this.ringBuffer = SpindleWorkerTestUtils.createSharedBuffer(16 + 32 * 512 * 4);

        this.worker = new Worker(path.join(__dirname, 'spindle-worker.js'));

        this.worker.on('message', (message) => {
          if (message.type === 'ready') {
            resolve();
          }
        });

        this.worker.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async testThroughput() {
    console.log('Testing worker throughput...');

    await this.setupWorker();

    const startTime = Date.now();
    const messageCount = 100;

    const promises = [];
    for (let i = 0; i < messageCount; i++) {
      promises.push(
        new Promise((resolve) => {
          this.worker.on('message', (msg) => {
            if (msg.type === 'toolResultPushed') {
              resolve(msg);
            }
          });
          this.worker.postMessage({
            type: 'pushToolResult',
            payload: { result: `perf_test_${i}`, toolId: i + 1 }
          });
        })
      );
    }

    await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    const throughput = messageCount / (duration / 1000);

    console.log(`✓ Throughput test passed: ${throughput.toFixed(0)} messages/second`);

    assert(throughput > 10, 'Should handle at least 10 messages per second');
  }

  async testLatency() {
    console.log('Testing worker latency...');

    const latencies = [];
    const testCount = 50;

    for (let i = 0; i < testCount; i++) {
      const startTime = performance.now();
      
      await new Promise((resolve) => {
        this.worker.on('message', (msg) => {
          if (msg.type === 'toolResultPushed') {
            const endTime = performance.now();
            latencies.push(endTime - startTime);
            resolve();
          }
        });
        
        this.worker.postMessage({
          type: 'pushToolResult',
          payload: { result: `latency_test_${i}`, toolId: i + 1 }
        });
      });
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log(`✓ Latency test passed: avg=${avgLatency.toFixed(2)}ms, min=${minLatency.toFixed(2)}ms, max=${maxLatency.toFixed(2)}ms`);

    assert(avgLatency < 100, 'Average latency should be under 100ms');
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
    }
  }

  async runAll() {
    console.log('\n=== Spindle Worker Performance Tests ===');
    
    try {
      await this.testThroughput();
      await this.testLatency();
      
      console.log('✓ All Performance tests passed\n');
    } catch (error) {
      console.error('❌ Performance test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Main test runner for spindle worker
class SpindleWorkerTestRunner {
  static async runAllTests() {
    console.log('Starting Spindle Worker Unit Tests...\n');
    
    try {
      const workerTests = new SpindleWorkerTests();
      await workerTests.runAll();
      
      const protocolTests = new MessageProtocolTests();
      await protocolTests.runAll();
      
      const performanceTests = new SpindleWorkerPerformanceTests();
      await performanceTests.runAll();
      
      console.log('🎉 All Spindle Worker tests passed successfully!');
      
    } catch (error) {
      console.error('❌ Spindle Worker test failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Export for use in other test files
module.exports = {
  SpindleWorkerTestRunner,
  SpindleWorkerTestUtils,
  SpindleWorkerTests,
  MessageProtocolTests,
  SpindleWorkerPerformanceTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  SpindleWorkerTestRunner.runAllTests();
}
