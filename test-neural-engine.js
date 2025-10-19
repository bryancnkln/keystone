/* ------------------------------------------------------------
 *  Neural Engine Unit Tests
 *  Tests for SIMDOpsService, NeuralMindService, RingBufferService,
 *  PrometheusService, and NeuralRouterService
 * ------------------------------------------------------------ */

// Test framework setup
const assert = require('assert');

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

// Test utilities
class TestUtils {
  static createRandomVector(size = FACET_SIZE) {
    const vec = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      vec[i] = Math.random() * 2 - 1; // [-1, 1]
    }
    return vec;
  }

  static createNormalizedVector(size = FACET_SIZE) {
    const vec = this.createRandomVector(size);
    let sum = 0;
    for (let i = 0; i < size; i++) sum += vec[i] * vec[i];
    const norm = Math.sqrt(sum);
    if (norm > 0) {
      for (let i = 0; i < size; i++) vec[i] /= norm;
    }
    return vec;
  }

  static assertVectorEqual(a, b, tolerance = 1e-6) {
    assert.strictEqual(a.length, b.length, 'Vector lengths must match');
    for (let i = 0; i < a.length; i++) {
      assert(Math.abs(a[i] - b[i]) < tolerance, 
        `Vector elements differ at index ${i}: ${a[i]} vs ${b[i]}`);
    }
  }

  static assertVectorClose(a, b, tolerance = 1e-6) {
    assert.strictEqual(a.length, b.length, 'Vector lengths must match');
    for (let i = 0; i < a.length; i++) {
      assert(Math.abs(a[i] - b[i]) < tolerance, 
        `Vector elements differ at index ${i}: ${a[i]} vs ${b[i]}`);
    }
  }
}

// Test suite for SIMDOpsService
class SIMDOpsServiceTests {
  constructor() {
    this.simd = new SIMDOpsService();
  }

  testCosineSimilarity() {
    console.log('Testing cosine similarity...');
    
    // Test identical vectors
    const vec1 = TestUtils.createNormalizedVector();
    const vec2 = new Float32Array(vec1);
    const sim = this.simd.cosineSimilarity(vec1, vec2);
    assert(Math.abs(sim - 1.0) < 1e-6, `Expected similarity ~1.0, got ${sim}`);
    
    // Test orthogonal vectors
    const vec3 = new Float32Array(FACET_SIZE);
    vec3[0] = 1;
    const vec4 = new Float32Array(FACET_SIZE);
    vec4[1] = 1;
    const simOrtho = this.simd.cosineSimilarity(vec3, vec4);
    assert(Math.abs(simOrtho) < 1e-6, `Expected similarity ~0.0, got ${simOrtho}`);
    
    // Test error handling
    const shortVec = new Float32Array(100);
    assert.throws(() => {
      this.simd.cosineSimilarity(vec1, shortVec);
    }, /Vectors must be 512 floats/);
    
    console.log('✓ Cosine similarity tests passed');
  }

  testNormalize() {
    console.log('Testing vector normalization...');
    
    const vec = TestUtils.createRandomVector();
    const original = new Float32Array(vec);
    this.simd.normalize(vec);
    
    // Check that vector is normalized
    let sum = 0;
    for (let i = 0; i < FACET_SIZE; i++) {
      sum += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sum);
    assert(Math.abs(norm - 1.0) < 1e-6, `Expected norm ~1.0, got ${norm}`);
    
    // Test zero vector
    const zeroVec = new Float32Array(FACET_SIZE);
    this.simd.normalize(zeroVec);
    // Should not crash
    
    console.log('✓ Normalization tests passed');
  }

  testAddScaled() {
    console.log('Testing addScaled operation...');
    
    const target = TestUtils.createRandomVector();
    const source = TestUtils.createRandomVector();
    const scale = 0.5;
    const original = new Float32Array(target);
    
    this.simd.addScaled(target, source, scale);
    
    // Verify result
    for (let i = 0; i < FACET_SIZE; i++) {
      const expected = original[i] + source[i] * scale;
      assert(Math.abs(target[i] - expected) < 1e-6, 
        `AddScaled failed at index ${i}: expected ${expected}, got ${target[i]}`);
    }
    
    console.log('✓ AddScaled tests passed');
  }

  testClipGradient() {
    console.log('Testing gradient clipping...');
    
    const grad = TestUtils.createRandomVector();
    const maxNorm = 1.0;
    
    this.simd.clipGradient(grad, maxNorm);
    
    // Check that gradient norm is within bounds
    let sum = 0;
    for (let i = 0; i < FACET_SIZE; i++) {
      sum += grad[i] * grad[i];
    }
    const norm = Math.sqrt(sum);
    assert(norm <= maxNorm + 1e-6, `Gradient norm ${norm} exceeds max ${maxNorm}`);
    
    console.log('✓ Gradient clipping tests passed');
  }

  testSoftmax() {
    console.log('Testing softmax operation...');
    
    const vec = TestUtils.createRandomVector();
    this.simd.softmax(vec);
    
    // Check that all values are positive and sum to 1
    let sum = 0;
    for (let i = 0; i < FACET_SIZE; i++) {
      assert(vec[i] >= 0, `Softmax value ${vec[i]} is negative`);
      sum += vec[i];
    }
    assert(Math.abs(sum - 1.0) < 1e-6, `Softmax sum ${sum} is not 1.0`);
    
    console.log('✓ Softmax tests passed');
  }

  testReLU() {
    console.log('Testing ReLU operation...');
    
    const vec = TestUtils.createRandomVector();
    const original = new Float32Array(vec);
    
    this.simd.relu(vec);
    
    // Check that negative values are zeroed
    for (let i = 0; i < FACET_SIZE; i++) {
      if (original[i] < 0) {
        assert(vec[i] === 0, `ReLU failed: negative value ${original[i]} not zeroed`);
      } else {
        assert(Math.abs(vec[i] - original[i]) < 1e-6, 
          `ReLU failed: positive value changed`);
      }
    }
    
    console.log('✓ ReLU tests passed');
  }

  testBenchmark() {
    console.log('Testing benchmark function...');
    
    const testFn = () => {
      const a = TestUtils.createRandomVector();
      const b = TestUtils.createRandomVector();
      return this.simd.cosineSimilarity(a, b);
    };
    
    const avgTime = this.simd.benchmark(testFn, 1000);
    assert(avgTime > 0, 'Benchmark should return positive time');
    assert(avgTime < 1000, 'Benchmark time seems too high'); // Should be microseconds
    
    console.log(`✓ Benchmark test passed (avg: ${avgTime.toFixed(2)}μs)`);
  }

  runAll() {
    console.log('\n=== SIMDOpsService Tests ===');
    this.testCosineSimilarity();
    this.testNormalize();
    this.testAddScaled();
    this.testClipGradient();
    this.testSoftmax();
    this.testReLU();
    this.testBenchmark();
    console.log('✓ All SIMDOpsService tests passed\n');
  }
}

// Test suite for NeuralMindService
class NeuralMindServiceTests {
  constructor() {
    this.mind = new NeuralMindService();
  }

  testInitialization() {
    console.log('Testing NeuralMind initialization...');
    
    assert(this.mind.mind.byteLength === 64 * 1024, 'Mind buffer should be 64KB');
    assert(this.mind.facetViews.length === 16, 'Should have 16 facet views');
    
    console.log('✓ Initialization tests passed');
  }

  testFacetOperations() {
    console.log('Testing facet operations...');
    
    const testVec = TestUtils.createRandomVector();
    
    // Test write and read
    this.mind.writeFacet(FacetType.INTENT, testVec);
    const readVec = new Float32Array(FACET_SIZE);
    this.mind.readFacet(FacetType.INTENT, readVec);
    
    TestUtils.assertVectorClose(testVec, readVec);
    
    // Test getFacet
    const facet = this.mind.getFacet(FacetType.INTENT);
    TestUtils.assertVectorClose(testVec, facet);
    
    // Test error handling
    assert.throws(() => {
      this.mind.getFacet(16); // Invalid facet index
    }, /Invalid facet 16/);
    
    console.log('✓ Facet operation tests passed');
  }

  testGradientApplication() {
    console.log('Testing gradient application...');
    
    const initialVec = TestUtils.createRandomVector();
    const gradient = TestUtils.createRandomVector();
    const learningRate = 0.01;
    
    this.mind.writeFacet(FacetType.INTENT, initialVec);
    this.mind.applyGradient(FacetType.INTENT, gradient, learningRate);
    
    const result = this.mind.getFacet(FacetType.INTENT);
    
    // Verify gradient was applied
    for (let i = 0; i < FACET_SIZE; i++) {
      const expected = initialVec[i] + learningRate * gradient[i];
      assert(Math.abs(result[i] - expected) < 1e-6, 
        `Gradient application failed at index ${i}`);
    }
    
    console.log('✓ Gradient application tests passed');
  }

  testReset() {
    console.log('Testing reset operations...');
    
    // Fill with data
    const testVec = TestUtils.createRandomVector();
    this.mind.writeFacet(FacetType.INTENT, testVec);
    
    // Reset specific facet
    this.mind.resetFacet(FacetType.INTENT);
    const facet = this.mind.getFacet(FacetType.INTENT);
    
    for (let i = 0; i < FACET_SIZE; i++) {
      assert(facet[i] === 0, `Facet not reset to zero at index ${i}`);
    }
    
    // Reset all
    this.mind.reset();
    const allZero = this.mind.getRawView();
    for (let i = 0; i < allZero.length; i++) {
      assert(allZero[i] === 0, `Mind not fully reset at index ${i}`);
    }
    
    console.log('✓ Reset tests passed');
  }

  testSnapshot() {
    console.log('Testing snapshot functionality...');
    
    const testVec = TestUtils.createRandomVector();
    this.mind.writeFacet(FacetType.INTENT, testVec);
    
    const snapshot = this.mind.snapshot();
    
    assert(snapshot.timestamp > 0, 'Snapshot should have timestamp');
    assert(snapshot.facets.size === 16, 'Snapshot should have 16 facets');
    
    const snapshotVec = snapshot.facets.get(FacetType.INTENT);
    TestUtils.assertVectorClose(testVec, snapshotVec);
    
    console.log('✓ Snapshot tests passed');
  }

  runAll() {
    console.log('\n=== NeuralMindService Tests ===');
    this.testInitialization();
    this.testFacetOperations();
    this.testGradientApplication();
    this.testReset();
    this.testSnapshot();
    console.log('✓ All NeuralMindService tests passed\n');
  }
}

// Test suite for RingBufferService
class RingBufferServiceTests {
  constructor() {
    this.ring = new RingBufferService();
  }

  testInitialization() {
    console.log('Testing RingBuffer initialization...');
    
    assert(this.ring.getHead() === 0, 'Initial head should be 0');
    assert(this.ring.getTail() === 0, 'Initial tail should be 0');
    assert(this.ring.getGeneration() === 0, 'Initial generation should be 0');
    assert(!this.ring.isFull(), 'Initial buffer should not be full');
    assert(this.ring.available() === 0, 'Initial buffer should be empty');
    
    console.log('✓ Initialization tests passed');
  }

  testPushAndRead() {
    console.log('Testing push and read operations...');
    
    const testVec = TestUtils.createRandomVector();
    const slotIndex = this.ring.push(testVec);
    
    assert(slotIndex === 0, `Expected slot index 0, got ${slotIndex}`);
    assert(this.ring.getHead() === 1, 'Head should advance to 1');
    assert(this.ring.available() === 1, 'Should have 1 available slot');
    
    const readVec = this.ring.readNext();
    assert(readVec !== null, 'Should be able to read pushed vector');
    TestUtils.assertVectorClose(testVec, readVec);
    
    assert(this.ring.getTail() === 1, 'Tail should advance to 1');
    assert(this.ring.available() === 0, 'Should be empty after read');
    
    console.log('✓ Push and read tests passed');
  }

  testRingWraparound() {
    console.log('Testing ring buffer wraparound...');

    // Fill buffer to capacity (31 slots - this is the maximum before full)
    for (let i = 0; i < 31; i++) {
      const vec = TestUtils.createRandomVector();
      vec[0] = i; // Mark with index for verification
      this.ring.push(vec);
    }

    // Buffer should be full after 31 pushes (when next would equal tail)
    assert(this.ring.isFull(), 'Buffer should be full after 31 pushes');

    // Try to push one more - should throw error
    const extraVec = TestUtils.createRandomVector();
    assert.throws(() => {
      this.ring.push(extraVec);
    }, /Ring buffer full/);

    // Read all vectors (should get 31 total)
    for (let i = 0; i < 31; i++) {
      const vec = this.ring.readNext();
      assert(vec !== null, `Should be able to read vector ${i}`);
      assert(vec[0] === i, `Vector ${i} has wrong marker`);
    }

    assert(this.ring.available() === 0, 'Should be empty after reading all');

    console.log('✓ Ring wraparound tests passed');
  }

  testConcurrentAccess() {
    console.log('Testing concurrent access simulation...');
    
    // Simulate concurrent pushes
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(new Promise((resolve) => {
        setTimeout(() => {
          const vec = TestUtils.createRandomVector();
          vec[0] = i;
          const slotIndex = this.ring.push(vec);
          resolve({ slotIndex, marker: i });
        }, Math.random() * 10);
      }));
    }
    
    return Promise.all(promises).then((results) => {
      assert(results.length === 10, 'Should have 10 results');
      assert(this.ring.available() === 10, 'Should have 10 available slots');
      
      console.log('✓ Concurrent access tests passed');
    });
  }

  testErrorHandling() {
    console.log('Testing error handling...');
    
    // Test invalid embedding size
    const shortVec = new Float32Array(100);
    assert.throws(() => {
      this.ring.push(shortVec);
    }, /Embedding must be 512/);
    
    // Test invalid slot index
    assert.throws(() => {
      this.ring.getSlot(50);
    }, /Index 50 out of bounds/);
    
    console.log('✓ Error handling tests passed');
  }

  runAll() {
    console.log('\n=== RingBufferService Tests ===');
    this.testInitialization();
    this.testPushAndRead();
    this.testRingWraparound();
    this.testConcurrentAccess();
    this.testErrorHandling();
    console.log('✓ All RingBufferService tests passed\n');
  }
}

// Test suite for NeuralRouterService
class NeuralRouterServiceTests {
  constructor() {
    this.mind = new NeuralMindService();
    this.ring = new RingBufferService();
    this.simd = new SIMDOpsService();
    this.router = new NeuralRouterService(this.mind, this.ring, this.simd);
  }

  testInitialization() {
    console.log('Testing NeuralRouter initialization...');
    
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() },
      { toolId: 2, name: 'Search', centroid: TestUtils.createNormalizedVector() },
      { toolId: 3, name: 'Analyze', centroid: TestUtils.createNormalizedVector() }
    ];
    
    this.router.initializeToolMap(tools);
    
    assert(this.router.toolMap.length === 3, 'Should have 3 tools');
    assert(this.router.toolMap[0].toolId === 1, 'First tool should have ID 1');
    
    console.log('✓ Initialization tests passed');
  }

  testRouting() {
    console.log('Testing routing functionality...');
    
    // Initialize with test tools
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() },
      { toolId: 2, name: 'Search', centroid: TestUtils.createNormalizedVector() },
      { toolId: 3, name: 'Analyze', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);
    
    // Set intent vector
    const intent = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, intent);
    
    const result = this.router.route();

    console.log(`Routing result: toolId=${result.toolId}, confidence=${result.confidence}, latency=${result.latency}`);

    assert(result.toolId >= 1 && result.toolId <= 3, 'Tool ID should be valid');
    assert(typeof result.confidence === 'number' && !isNaN(result.confidence), 'Confidence should be a valid number');
    assert(result.latency > 0, 'Latency should be positive');
    assert(result.intentVector.length === FACET_SIZE, 'Intent vector should be correct size');
    
    console.log('✓ Routing tests passed');
  }

  testTopKRouting() {
    console.log('Testing top-K routing...');
    
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() },
      { toolId: 2, name: 'Search', centroid: TestUtils.createNormalizedVector() },
      { toolId: 3, name: 'Analyze', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);
    
    const intent = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, intent);
    
    const results = this.router.routeTopK(2);
    
    assert(results.length === 2, 'Should return 2 results');
    assert(results[0].confidence >= results[1].confidence, 'Results should be sorted by confidence');
    
    console.log('✓ Top-K routing tests passed');
  }

  testToolUpdate() {
    console.log('Testing tool update...');
    
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);
    
    const originalCentroid = new Float32Array(this.router.toolMap[0].centroid);
    const feedback = TestUtils.createNormalizedVector();
    
    this.router.updateTool(1, feedback, 0.1);
    
    const updatedCentroid = this.router.toolMap[0].centroid;
    assert(this.router.toolMap[0].hitCount === 1, 'Hit count should increment');
    
    // Verify centroid changed
    let changed = false;
    for (let i = 0; i < FACET_SIZE; i++) {
      if (Math.abs(originalCentroid[i] - updatedCentroid[i]) > 1e-6) {
        changed = true;
        break;
      }
    }
    assert(changed, 'Centroid should have changed');
    
    console.log('✓ Tool update tests passed');
  }

  testAccuracyRecording() {
    console.log('Testing accuracy recording...');
    
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);
    
    // Record some accuracy data
    this.router.recordAccuracy(1, true);
    this.router.recordAccuracy(1, false);
    this.router.recordAccuracy(1, true);
    
    const stats = this.router.getToolStats(1);
    assert(stats.accuracy > 0 && stats.accuracy < 1, 'Accuracy should be between 0 and 1');
    
    console.log('✓ Accuracy recording tests passed');
  }

  testBenchmark() {
    console.log('Testing router benchmark...');
    
    const tools = [
      { toolId: 1, name: 'Navigate', centroid: TestUtils.createNormalizedVector() }
    ];
    this.router.initializeToolMap(tools);
    
    const intent = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, intent);
    
    const benchmark = this.router.benchmark(100);
    
    assert(benchmark.avgLatencyMs > 0, 'Average latency should be positive');
    assert(benchmark.minLatencyMs > 0, 'Min latency should be positive');
    assert(benchmark.maxLatencyMs > 0, 'Max latency should be positive');
    assert(benchmark.throughputRps > 0, 'Throughput should be positive');
    
    console.log(`✓ Benchmark tests passed (${benchmark.throughputRps.toFixed(0)} RPS)`);
  }

  runAll() {
    console.log('\n=== NeuralRouterService Tests ===');
    this.testInitialization();
    this.testRouting();
    this.testTopKRouting();
    this.testToolUpdate();
    this.testAccuracyRecording();
    this.testBenchmark();
    console.log('✓ All NeuralRouterService tests passed\n');
  }
}

// Test suite for PrometheusService
class PrometheusServiceTests {
  constructor() {
    this.mind = new NeuralMindService();
    this.simd = new SIMDOpsService();
    this.prometheus = new PrometheusService(this.mind, this.simd);
  }

  testInitialization() {
    console.log('Testing Prometheus initialization...');
    
    const stats = this.prometheus.getStats();
    assert(stats.facetsMonitored > 0, 'Should monitor some facets');
    assert(stats.handlersRegistered === 0, 'Should start with no handlers');
    assert(!stats.monitoring, 'Should not be monitoring initially');
    
    console.log('✓ Initialization tests passed');
  }

  testThresholdMonitoring() {
    console.log('Testing threshold monitoring...');
    
    let interruptFired = false;
    this.prometheus.onInterrupt(FacetType.INTENT, (intr) => {
      interruptFired = true;
      assert(intr.facet === FacetType.INTENT, 'Interrupt should be for INTENT facet');
      assert(intr.similarity >= 0 && intr.similarity <= 1, 'Similarity should be normalized');
    });
    
    // Create a significant change in INTENT facet
    const originalVec = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, originalVec);
    
    const changedVec = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, changedVec);
    
    this.prometheus.start(1); // Start monitoring with 1ms interval
    
    // Wait a bit for monitoring to detect change
    setTimeout(() => {
      this.prometheus.stop();
      assert(interruptFired, 'Interrupt should have fired');
      console.log('✓ Threshold monitoring tests passed');
    }, 50);
  }

  testAdaptiveThresholds() {
    console.log('Testing adaptive thresholds...');
    
    // Set a high initial threshold to ensure we can decrease it
    this.prometheus.setThreshold({
      facet: FacetType.INTENT,
      threshold: 0.8,
      learningRate: 0.1
    });
    
    const originalThreshold = this.prometheus.getThreshold(FacetType.INTENT).threshold;
    
    // Simulate low similarity to trigger adaptation
    const lowSimVec = TestUtils.createNormalizedVector();
    this.mind.writeFacet(FacetType.INTENT, lowSimVec);
    
    this.prometheus.adapt(FacetType.INTENT, 0.3); // Low similarity
    
    const newThreshold = this.prometheus.getThreshold(FacetType.INTENT).threshold;
    console.log(`Original threshold: ${originalThreshold}, New threshold: ${newThreshold}`);
    assert(newThreshold < originalThreshold, 'Threshold should decrease for low similarity');
    
    console.log('✓ Adaptive thresholds tests passed');
  }

  runAll() {
    console.log('\n=== PrometheusService Tests ===');
    this.testInitialization();
    this.testThresholdMonitoring();
    this.testAdaptiveThresholds();
    console.log('✓ All PrometheusService tests passed\n');
  }
}

// Main test runner
class TestRunner {
  static async runAllTests() {
    console.log('Starting Neural Engine Unit Tests...\n');
    
    try {
      // Run synchronous tests
      new SIMDOpsServiceTests().runAll();
      new NeuralMindServiceTests().runAll();
      new RingBufferServiceTests().runAll();
      new NeuralRouterServiceTests().runAll();
      new PrometheusServiceTests().runAll();
      
      console.log('🎉 All tests passed successfully!');
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Export for use in other test files
module.exports = {
  TestRunner,
  TestUtils,
  SIMDOpsServiceTests,
  NeuralMindServiceTests,
  RingBufferServiceTests,
  NeuralRouterServiceTests,
  PrometheusServiceTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  TestRunner.runAllTests();
}
