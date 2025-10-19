/* ------------------------------------------------------------
 *  Integration Tests
 *  Tests for complete system integration between neural-engine,
 *  spindle-worker, and server components
 * ------------------------------------------------------------ */

const assert = require('assert');
const http = require('http');
const { Worker } = require('worker_threads');
const path = require('path');

// Import test utilities from other test files
const { TestUtils } = require('./test-neural-engine.js');
const { SpindleWorkerTestUtils } = require('./test-spindle-worker.js');
const { ServerTestUtils } = require('./test-server.js');

// Import the neural engine modules
const { 
  SIMDOpsService, 
  NeuralMindService, 
  RingBufferService,
  PrometheusService, 
  NeuralRouterService,
  FacetType, 
  FACET_SIZE 
} = require('./neural-engine.js');

// Integration test utilities
class IntegrationTestUtils {
  static createTestServer(port = 8084) {
    return new Promise((resolve, reject) => {
      try {
        const { spawn } = require('child_process');
        const serverProcess = spawn('node', ['server.js'], {
          cwd: __dirname,
          env: { ...process.env, PORT: port }
        });

        serverProcess.stdout.on('data', (data) => {
          if (data.toString().includes('Server listening')) {
            resolve(serverProcess);
          }
        });

        serverProcess.on('error', reject);

        setTimeout(() => {
          reject(new Error('Server startup timeout'));
        }, 5000);

      } catch (error) {
        reject(error);
      }
    });
  }

  static async createWorkerWithBuffers() {
    const mindBuffer = SpindleWorkerTestUtils.createSharedBuffer(64 * 1024);
    const ringBuffer = SpindleWorkerTestUtils.createSharedBuffer(16 + 32 * 512 * 4);

    const worker = new Worker(path.join(__dirname, 'spindle-worker.js'));

    return new Promise((resolve, reject) => {
      worker.on('message', (message) => {
        if (message.type === 'ready') {
          resolve({ worker, mindBuffer, ringBuffer });
        }
      });

      worker.on('error', reject);
    });
  }

  static async initializeWorker(worker, mindBuffer, ringBuffer) {
    return new Promise((resolve, reject) => {
      worker.on('message', (message) => {
        if (message.type === 'initialized') {
          resolve();
        } else if (message.type === 'error') {
          reject(new Error(message.payload.message));
        }
      });

      worker.postMessage({
        type: 'init',
        payload: { mindBuffer, ringBuffer }
      });
    });
  }
}

// Test suite for Neural Engine + Spindle Worker Integration
class NeuralWorkerIntegrationTests {
  constructor() {
    this.mind = null;
    this.ring = null;
    this.simd = null;
    this.router = null;
    this.worker = null;
    this.mindBuffer = null;
    this.ringBuffer = null;
  }

  async setup() {
    console.log('Setting up neural engine + worker integration...');

    // Initialize neural engine components
    this.mind = new NeuralMindService();
    this.ring = new RingBufferService();
    this.simd = new SIMDOpsService();
    this.router = new NeuralRouterService(this.mind, this.ring, this.simd);

    // Initialize worker
    const workerSetup = await IntegrationTestUtils.createWorkerWithBuffers();
    this.worker = workerSetup.worker;
    this.mindBuffer = workerSetup.mindBuffer;
    this.ringBuffer = workerSetup.ringBuffer;

    // Initialize worker with buffers
    await IntegrationTestUtils.initializeWorker(this.worker, this.mindBuffer, this.ringBuffer);

    console.log('✓ Integration setup complete');
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
    }
  }

  async testSharedBufferCommunication() {
    console.log('Testing shared buffer communication...');

    // Create test data in neural engine
    const testEmbedding = TestUtils.createRandomVector();
    const slotIndex = this.ring.push(testEmbedding);

    // Send embedding to worker
    const workerResponse = await new Promise((resolve) => {
      this.worker.on('message', (msg) => {
        if (msg.type === 'embeddingPushed') {
          resolve(msg);
        }
      });
      this.worker.postMessage({
        type: 'pushEmbedding',
        payload: { embedding: Array.from(testEmbedding), toolId: 1 }
      });
    });

    assert.strictEqual(workerResponse.type, 'embeddingPushed', 'Worker should acknowledge embedding');
    assert(typeof workerResponse.payload.slotIndex === 'number', 'Should have slot index');

    console.log('✓ Shared buffer communication tests passed');
  }

  async testToolResultProcessing() {
    console.log('Testing tool result processing...');

    // Initialize router with test tools
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() },
      { toolId: 2, name: 'Search', centroid: TestUtils.createNormalizedVector() },
      { toolId: 3, name: 'Analyze', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);

    // Set intent and route
    const intent = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, intent);
    const routingResult = this.router.route();

    assert(routingResult.toolId >= 1 && routingResult.toolId <= 3, 'Should route to valid tool');
    assert(routingResult.confidence >= 0 && routingResult.confidence <= 1, 'Should have valid confidence');

    // Send tool result to worker
    const toolResult = `Result from tool ${routingResult.toolId}`;
    const workerResponse = await new Promise((resolve) => {
      this.worker.on('message', (msg) => {
        if (msg.type === 'toolResultPushed') {
          resolve(msg);
        }
      });
      this.worker.postMessage({
        type: 'pushToolResult',
        payload: { result: toolResult, toolId: routingResult.toolId }
      });
    });

    assert.strictEqual(workerResponse.type, 'toolResultPushed', 'Worker should process tool result');
    assert.strictEqual(workerResponse.payload.toolId, routingResult.toolId, 'Should have correct tool ID');

    console.log('✓ Tool result processing tests passed');
  }

  async testConcurrentOperations() {
    console.log('Testing concurrent operations...');

    const promises = [];

    // Concurrent neural engine operations
    for (let i = 0; i < 5; i++) {
      promises.push(new Promise((resolve) => {
        const embedding = TestUtils.createRandomVector();
        const slotIndex = this.ring.push(embedding);
        resolve({ slotIndex, iteration: i });
      }));
    }

    // Concurrent worker operations
    for (let i = 0; i < 5; i++) {
      promises.push(new Promise((resolve) => {
        this.worker.on('message', (msg) => {
          if (msg.type === 'toolResultPushed' && msg.payload.toolId === i + 1) {
            resolve(msg);
          }
        });
        this.worker.postMessage({
          type: 'pushToolResult',
          payload: { result: `concurrent_test_${i}`, toolId: i + 1 }
        });
      }));
    }

    const results = await Promise.all(promises);
    assert(results.length === 10, 'Should complete all concurrent operations');

    console.log('✓ Concurrent operations tests passed');
  }

  async testMemoryConsistency() {
    console.log('Testing memory consistency...');

    // Fill ring buffer in neural engine
    const testEmbeddings = [];
    for (let i = 0; i < 10; i++) {
      const embedding = TestUtils.createRandomVector();
      embedding[0] = i; // Mark with index
      testEmbeddings.push(embedding);
      this.ring.push(embedding);
    }

    // Check neural engine stats
    const neuralStats = {
      head: this.ring.getHead(),
      tail: this.ring.getTail(),
      generation: this.ring.getGeneration(),
      available: this.ring.available()
    };

    // Check worker stats
    const workerStats = await new Promise((resolve) => {
      this.worker.on('message', (msg) => {
        if (msg.type === 'stats') {
          resolve(msg.payload);
        }
      });
      this.worker.postMessage({ type: 'getStats' });
    });

    // Stats should be consistent (allowing for timing differences)
    assert(Math.abs(neuralStats.available - workerStats.available) <= 1, 
      'Available slots should be consistent between neural engine and worker');

    console.log('✓ Memory consistency tests passed');
  }

  async runAll() {
    console.log('\n=== Neural Engine + Worker Integration Tests ===');
    
    try {
      await this.setup();
      await this.testSharedBufferCommunication();
      await this.testToolResultProcessing();
      await this.testConcurrentOperations();
      await this.testMemoryConsistency();
      
      console.log('✓ All Neural Engine + Worker integration tests passed\n');
    } catch (error) {
      console.error('❌ Integration test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Test suite for Server + Neural Engine Integration
class ServerNeuralIntegrationTests {
  constructor() {
    this.serverProcess = null;
    this.testPort = 8085;
  }

  async setup() {
    console.log('Setting up server + neural engine integration...');

    this.serverProcess = await IntegrationTestUtils.createTestServer(this.testPort);
    await ServerTestUtils.waitForServer(this.testPort);

    console.log('✓ Server + neural engine setup complete');
  }

  async cleanup() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }

  async testServerServesNeuralEngine() {
    console.log('Testing server serves neural engine files...');

    // Test that server can serve the neural engine JavaScript file
    const response = await ServerTestUtils.makeRequest(this.testPort, '/neural-engine.js');
    
    assert(response.statusCode === 200, 'Should serve neural-engine.js');
    assert(response.headers['content-type'] === 'application/javascript', 'Should have correct content type');
    assert(response.data.includes('SIMDOpsService'), 'Should contain neural engine code');

    console.log('✓ Server serves neural engine tests passed');
  }

  async testServerServesSpindleWorker() {
    console.log('Testing server serves spindle worker files...');

    const response = await ServerTestUtils.makeRequest(this.testPort, '/spindle-worker.js');
    
    assert(response.statusCode === 200, 'Should serve spindle-worker.js');
    assert(response.headers['content-type'] === 'application/javascript', 'Should have correct content type');
    assert(response.data.includes('Spindle Worker'), 'Should contain spindle worker code');

    console.log('✓ Server serves spindle worker tests passed');
  }

  async testServerServesHTMLDemo() {
    console.log('Testing server serves HTML demo...');

    const response = await ServerTestUtils.makeRequest(this.testPort, '/keystoneH.html');
    
    assert(response.statusCode === 200, 'Should serve keystoneH.html');
    assert(response.headers['content-type'] === 'text/html', 'Should have correct content type');
    assert(response.data.includes('KeyStoneH'), 'Should contain KeyStoneH demo');

    console.log('✓ Server serves HTML demo tests passed');
  }

  async testCORSHeadersForSharedArrayBuffer() {
    console.log('Testing CORS headers for SharedArrayBuffer...');

    const response = await ServerTestUtils.makeRequest(this.testPort, '/neural-engine.js');
    
    // Check required headers for SharedArrayBuffer
    assert(response.headers['cross-origin-opener-policy'] === 'same-origin', 
      'Should have COOP header for SharedArrayBuffer');
    assert(response.headers['cross-origin-embedder-policy'] === 'require-corp', 
      'Should have COEP header for SharedArrayBuffer');

    console.log('✓ CORS headers for SharedArrayBuffer tests passed');
  }

  async runAll() {
    console.log('\n=== Server + Neural Engine Integration Tests ===');
    
    try {
      await this.setup();
      await this.testServerServesNeuralEngine();
      await this.testServerServesSpindleWorker();
      await this.testServerServesHTMLDemo();
      await this.testCORSHeadersForSharedArrayBuffer();
      
      console.log('✓ All Server + Neural Engine integration tests passed\n');
    } catch (error) {
      console.error('❌ Server integration test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Test suite for Complete System Integration
class CompleteSystemIntegrationTests {
  constructor() {
    this.serverProcess = null;
    this.testPort = 8086;
    this.mind = null;
    this.ring = null;
    this.simd = null;
    this.router = null;
    this.worker = null;
  }

  async setup() {
    console.log('Setting up complete system integration...');

    // Start server
    this.serverProcess = await IntegrationTestUtils.createTestServer(this.testPort);
    await ServerTestUtils.waitForServer(this.testPort);

    // Initialize neural engine
    this.mind = new NeuralMindService();
    this.ring = new RingBufferService();
    this.simd = new SIMDOpsService();
    this.router = new NeuralRouterService(this.mind, this.ring, this.simd);

    // Initialize worker
    const workerSetup = await IntegrationTestUtils.createWorkerWithBuffers();
    this.worker = workerSetup.worker;
    await IntegrationTestUtils.initializeWorker(this.worker, workerSetup.mindBuffer, workerSetup.ringBuffer);

    console.log('✓ Complete system setup complete');
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }

  async testEndToEndWorkflow() {
    console.log('Testing end-to-end workflow...');

    // Initialize router with tools
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() },
      { toolId: 2, name: 'Search', centroid: TestUtils.createNormalizedVector() },
      { toolId: 3, name: 'Analyze', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);

    // Simulate user intent
    const intent = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, intent);

    // Route to tool
    const routingResult = this.router.route();
    assert(routingResult.toolId >= 1 && routingResult.toolId <= 3, 'Should route to valid tool');

    // Simulate tool execution and result
    const toolResult = `Executed ${tools[routingResult.toolId - 1].name} with confidence ${routingResult.confidence.toFixed(3)}`;

    // Send result to worker
    const workerResponse = await new Promise((resolve) => {
      this.worker.on('message', (msg) => {
        if (msg.type === 'toolResultPushed') {
          resolve(msg);
        }
      });
      this.worker.postMessage({
        type: 'pushToolResult',
        payload: { result: toolResult, toolId: routingResult.toolId }
      });
    });

    assert.strictEqual(workerResponse.payload.toolId, routingResult.toolId, 'Worker should process correct tool result');

    // Update tool based on feedback
    this.router.updateTool(routingResult.toolId, intent, 0.1);
    const toolStats = this.router.getToolStats(routingResult.toolId);
    assert(toolStats.hitCount === 1, 'Tool hit count should increment');

    console.log('✓ End-to-end workflow tests passed');
  }

  async testSystemPerformance() {
    console.log('Testing system performance...');

    const startTime = Date.now();
    const operationCount = 50;

    const promises = [];

    // Mix of neural engine and worker operations
    for (let i = 0; i < operationCount; i++) {
      if (i % 2 === 0) {
        // Neural engine operation
        promises.push(new Promise((resolve) => {
          const embedding = TestUtils.createRandomVector();
          const slotIndex = this.ring.push(embedding);
          resolve({ type: 'neural', slotIndex });
        }));
      } else {
        // Worker operation
        promises.push(new Promise((resolve) => {
          this.worker.on('message', (msg) => {
            if (msg.type === 'toolResultPushed' && msg.payload.toolId === i) {
              resolve({ type: 'worker', msg });
            }
          });
          this.worker.postMessage({
            type: 'pushToolResult',
            payload: { result: `perf_test_${i}`, toolId: i }
          });
        }));
      }
    }

    await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    const operationsPerSecond = operationCount / (duration / 1000);

    console.log(`✓ System performance test passed: ${operationsPerSecond.toFixed(0)} operations/second`);

    assert(operationsPerSecond > 5, 'Should handle at least 5 operations per second');
  }

  async testSystemStability() {
    console.log('Testing system stability...');

    // Run many operations to test stability
    for (let round = 0; round < 10; round++) {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(new Promise((resolve) => {
          this.worker.on('message', (msg) => {
            if (msg.type === 'toolResultPushed') {
              resolve(msg);
            }
          });
          this.worker.postMessage({
            type: 'pushToolResult',
            payload: { result: `stability_test_${round}_${i}`, toolId: i + 1 }
          });
        }));
      }

      await Promise.all(promises);
    }

    // Check final stats
    const finalStats = await new Promise((resolve) => {
      this.worker.on('message', (msg) => {
        if (msg.type === 'stats') {
          resolve(msg.payload);
        }
      });
      this.worker.postMessage({ type: 'getStats' });
    });

    assert(finalStats.available >= 0, 'System should remain stable after many operations');

    console.log('✓ System stability tests passed');
  }

  async runAll() {
    console.log('\n=== Complete System Integration Tests ===');
    
    try {
      await this.setup();
      await this.testEndToEndWorkflow();
      await this.testSystemPerformance();
      await this.testSystemStability();
      
      console.log('✓ All Complete System integration tests passed\n');
    } catch (error) {
      console.error('❌ Complete system test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Main integration test runner
class IntegrationTestRunner {
  static async runAllTests() {
    console.log('Starting Integration Tests...\n');
    
    try {
      const neuralWorkerTests = new NeuralWorkerIntegrationTests();
      await neuralWorkerTests.runAll();
      
      const serverNeuralTests = new ServerNeuralIntegrationTests();
      await serverNeuralTests.runAll();
      
      const completeSystemTests = new CompleteSystemIntegrationTests();
      await completeSystemTests.runAll();
      
      console.log('🎉 All Integration tests passed successfully!');
      
    } catch (error) {
      console.error('❌ Integration test failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Export for use in other test files
module.exports = {
  IntegrationTestRunner,
  IntegrationTestUtils,
  NeuralWorkerIntegrationTests,
  ServerNeuralIntegrationTests,
  CompleteSystemIntegrationTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  IntegrationTestRunner.runAllTests();
}
