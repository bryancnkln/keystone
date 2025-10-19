/* ------------------------------------------------------------
 *  Test Runner
 *  Main test runner that executes all test suites
 * ------------------------------------------------------------ */

const { TestRunner } = require('./test-neural-engine.js');
const { SpindleWorkerTestRunner } = require('./test-spindle-worker.js');
const { ServerTestRunner } = require('./test-server.js');
const { IntegrationTestRunner } = require('./test-integration.js');

class MainTestRunner {
  static async runAllTests() {
    console.log('🧠 KeyStoneH Neural Engine - Complete Test Suite');
    console.log('================================================\n');

    const startTime = Date.now();
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    const testSuites = [
      { name: 'Neural Engine Unit Tests', runner: TestRunner },
      { name: 'Spindle Worker Unit Tests', runner: SpindleWorkerTestRunner },
      { name: 'Server Unit Tests', runner: ServerTestRunner },
      { name: 'Integration Tests', runner: IntegrationTestRunner }
    ];

    for (const suite of testSuites) {
      console.log(`\n📋 Running ${suite.name}...`);
      console.log('─'.repeat(50));
      
      try {
        await suite.runner.runAllTests();
        passedTests++;
        console.log(`✅ ${suite.name} - PASSED`);
      } catch (error) {
        failedTests++;
        console.log(`❌ ${suite.name} - FAILED`);
        console.error(`   Error: ${error.message}`);
      }
      
      totalTests++;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Test Suites: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (failedTests === 0) {
      console.log('\n🎉 ALL TESTS PASSED! KeyStoneH Neural Engine is ready for production.');
    } else {
      console.log(`\n⚠️  ${failedTests} test suite(s) failed. Please review the errors above.`);
      process.exit(1);
    }
  }

  static async runSpecificTest(testName) {
    console.log(`🧠 KeyStoneH Neural Engine - Running ${testName}`);
    console.log('='.repeat(50));

    const startTime = Date.now();

    try {
      switch (testName.toLowerCase()) {
        case 'neural':
        case 'neural-engine':
          await TestRunner.runAllTests();
          break;
        case 'worker':
        case 'spindle-worker':
          await SpindleWorkerTestRunner.runAllTests();
          break;
        case 'server':
          await ServerTestRunner.runAllTests();
          break;
        case 'integration':
          await IntegrationTestRunner.runAllTests();
          break;
        default:
          console.error(`❌ Unknown test suite: ${testName}`);
          console.log('Available test suites: neural, worker, server, integration');
          process.exit(1);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(`\n✅ ${testName} tests completed in ${(duration / 1000).toFixed(2)}s`);

    } catch (error) {
      console.error(`❌ ${testName} tests failed:`, error.message);
      process.exit(1);
    }
  }

  static printHelp() {
    console.log('🧠 KeyStoneH Neural Engine - Test Runner');
    console.log('========================================\n');
    console.log('Usage:');
    console.log('  node test-runner.js                 # Run all tests');
    console.log('  node test-runner.js <suite>         # Run specific test suite');
    console.log('  npm test                           # Run all tests');
    console.log('  npm run test:neural                # Run neural engine tests');
    console.log('  npm run test:worker                # Run spindle worker tests');
    console.log('  npm run test:server                # Run server tests');
    console.log('  npm run test:integration           # Run integration tests');
    console.log('  npm run test:all                   # Run all tests sequentially');
    console.log('\nAvailable test suites:');
    console.log('  neural     - Neural Engine unit tests');
    console.log('  worker     - Spindle Worker unit tests');
    console.log('  server     - Server unit tests');
    console.log('  integration - Integration tests');
    console.log('\nTest Coverage:');
    console.log('  ✓ SIMDOpsService - Vector operations and SIMD');
    console.log('  ✓ NeuralMindService - 64KB SRAM management');
    console.log('  ✓ RingBufferService - Lock-free circular buffer');
    console.log('  ✓ PrometheusService - Threshold monitoring');
    console.log('  ✓ NeuralRouterService - Tool routing and learning');
    console.log('  ✓ Spindle Worker - Web Worker communication');
    console.log('  ✓ Server - HTTP serving and security');
    console.log('  ✓ Integration - End-to-end system tests');
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run all tests
    MainTestRunner.runAllTests();
  } else if (args[0] === '--help' || args[0] === '-h') {
    // Show help
    MainTestRunner.printHelp();
  } else {
    // Run specific test suite
    MainTestRunner.runSpecificTest(args[0]);
  }
}

module.exports = { MainTestRunner };
