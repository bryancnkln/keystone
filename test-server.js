/* ------------------------------------------------------------
 *  Server Unit Tests
 *  Tests for HTTP server functionality, CORS headers, and security
 * ------------------------------------------------------------ */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Test utilities for server testing
class ServerTestUtils {
  static createTestFile(filename, content) {
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  static deleteTestFile(filename) {
    const filePath = path.join(__dirname, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  static makeRequest(port, path, options = {}) {
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: 'localhost',
        port: port,
        path: path,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        });
      });

      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  static waitForServer(port, maxAttempts = 10) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const checkServer = () => {
        attempts++;
        const req = http.request({
          hostname: 'localhost',
          port: port,
          path: '/',
          method: 'GET'
        }, (res) => {
          resolve();
        });

        req.on('error', () => {
          if (attempts < maxAttempts) {
            setTimeout(checkServer, 100);
          } else {
            reject(new Error('Server did not start in time'));
          }
        });

        req.end();
      };
      checkServer();
    });
  }
}

// Test suite for HTTP Server
class ServerTests {
  constructor() {
    this.server = null;
    this.serverProcess = null;
    this.testPort = 8081; // Use different port to avoid conflicts
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      try {
        // Start server in a child process
        const { spawn } = require('child_process');
        this.serverProcess = spawn('node', ['server.js'], {
          cwd: __dirname,
          env: { ...process.env, PORT: this.testPort }
        });

        this.serverProcess.stdout.on('data', (data) => {
          if (data.toString().includes('Server listening')) {
            resolve();
          }
        });

        this.serverProcess.stderr.on('data', (data) => {
          console.error('Server error:', data.toString());
        });

        this.serverProcess.on('error', reject);

        // Timeout after 5 seconds
        setTimeout(() => {
          reject(new Error('Server startup timeout'));
        }, 5000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  async testServerStartup() {
    console.log('Testing server startup...');

    await this.startServer();
    await ServerTestUtils.waitForServer(this.testPort);

    // Test basic connectivity
    const response = await ServerTestUtils.makeRequest(this.testPort, '/');
    
    assert(response.statusCode === 404, 'Should return 404 for non-existent file');
    assert(response.data === 'Not found', 'Should return "Not found" message');

    console.log('✓ Server startup tests passed');
  }

  async testFileServing() {
    console.log('Testing file serving...');

    // Create test files
    const htmlContent = '<html><body>Test HTML</body></html>';
    const jsContent = 'console.log("test");';
    const cssContent = 'body { color: red; }';
    const jsonContent = '{"test": "data"}';

    ServerTestUtils.createTestFile('test.html', htmlContent);
    ServerTestUtils.createTestFile('test.js', jsContent);
    ServerTestUtils.createTestFile('test.css', cssContent);
    ServerTestUtils.createTestFile('test.json', jsonContent);

    try {
      // Test HTML file
      const htmlResponse = await ServerTestUtils.makeRequest(this.testPort, '/test.html');
      assert(htmlResponse.statusCode === 200, 'Should serve HTML file');
      assert(htmlResponse.headers['content-type'] === 'text/html', 'Should have correct content type');
      assert(htmlResponse.data === htmlContent, 'Should return correct HTML content');

      // Test JS file
      const jsResponse = await ServerTestUtils.makeRequest(this.testPort, '/test.js');
      assert(jsResponse.statusCode === 200, 'Should serve JS file');
      assert(jsResponse.headers['content-type'] === 'application/javascript', 'Should have correct content type');
      assert(jsResponse.data === jsContent, 'Should return correct JS content');

      // Test CSS file
      const cssResponse = await ServerTestUtils.makeRequest(this.testPort, '/test.css');
      assert(cssResponse.statusCode === 200, 'Should serve CSS file');
      assert(cssResponse.headers['content-type'] === 'text/css', 'Should have correct content type');
      assert(cssResponse.data === cssContent, 'Should return correct CSS content');

      // Test JSON file
      const jsonResponse = await ServerTestUtils.makeRequest(this.testPort, '/test.json');
      assert(jsonResponse.statusCode === 200, 'Should serve JSON file');
      assert(jsonResponse.headers['content-type'] === 'application/json', 'Should have correct content type');
      assert(jsonResponse.data === jsonContent, 'Should return correct JSON content');

    } finally {
      // Clean up test files
      ServerTestUtils.deleteTestFile('test.html');
      ServerTestUtils.deleteTestFile('test.js');
      ServerTestUtils.deleteTestFile('test.css');
      ServerTestUtils.deleteTestFile('test.json');
    }

    console.log('✓ File serving tests passed');
  }

  async testCORSHeaders() {
    console.log('Testing CORS headers...');

    const response = await ServerTestUtils.makeRequest(this.testPort, '/');

    // Check required CORS headers for SharedArrayBuffer
    assert(response.headers['cross-origin-opener-policy'] === 'same-origin', 
      'Should have Cross-Origin-Opener-Policy header');
    assert(response.headers['cross-origin-embedder-policy'] === 'require-corp', 
      'Should have Cross-Origin-Embedder-Policy header');

    console.log('✓ CORS headers tests passed');
  }

  async testSecurityHeaders() {
    console.log('Testing security headers...');

    const response = await ServerTestUtils.makeRequest(this.testPort, '/');

    // Check security headers
    assert(response.headers['x-content-type-options'] === 'nosniff', 
      'Should have X-Content-Type-Options header');
    assert(response.headers['x-frame-options'] === 'DENY', 
      'Should have X-Frame-Options header');
    assert(response.headers['referrer-policy'] === 'strict-origin-when-cross-origin', 
      'Should have Referrer-Policy header');

    console.log('✓ Security headers tests passed');
  }

  async testDirectoryTraversalProtection() {
    console.log('Testing directory traversal protection...');

    const maliciousPaths = [
      '../package.json',
      '../../etc/passwd',
      '..\\..\\windows\\system32\\drivers\\etc\\hosts',
      '~/bashrc',
      '....//....//etc//passwd'
    ];

    for (const maliciousPath of maliciousPaths) {
      const response = await ServerTestUtils.makeRequest(this.testPort, maliciousPath);
      assert(response.statusCode === 403, `Should block ${maliciousPath}`);
      assert(response.data === 'Forbidden', 'Should return Forbidden message');
    }

    console.log('✓ Directory traversal protection tests passed');
  }

  async testErrorHandling() {
    console.log('Testing error handling...');

    // Test non-existent file
    const response = await ServerTestUtils.makeRequest(this.testPort, '/nonexistent.html');
    assert(response.statusCode === 404, 'Should return 404 for non-existent file');
    assert(response.data === 'Not found', 'Should return "Not found" message');

    console.log('✓ Error handling tests passed');
  }

  async testDefaultFileServing() {
    console.log('Testing default file serving...');

    // Create index.html
    const indexContent = '<html><body>Index Page</body></html>';
    ServerTestUtils.createTestFile('index.html', indexContent);

    try {
      const response = await ServerTestUtils.makeRequest(this.testPort, '/');
      assert(response.statusCode === 200, 'Should serve index.html for root path');
      assert(response.data === indexContent, 'Should return index.html content');
    } finally {
      ServerTestUtils.deleteTestFile('index.html');
    }

    console.log('✓ Default file serving tests passed');
  }

  async testConcurrentRequests() {
    console.log('Testing concurrent requests...');

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(ServerTestUtils.makeRequest(this.testPort, '/'));
    }

    const responses = await Promise.all(promises);
    
    assert(responses.length === 10, 'Should handle all concurrent requests');
    responses.forEach((response, index) => {
      assert(response.statusCode === 404, `Request ${index} should return 404`);
    });

    console.log('✓ Concurrent requests tests passed');
  }

  async testPerformance() {
    console.log('Testing server performance...');

    const startTime = Date.now();
    const requestCount = 100;

    const promises = [];
    for (let i = 0; i < requestCount; i++) {
      promises.push(ServerTestUtils.makeRequest(this.testPort, '/'));
    }

    await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    const requestsPerSecond = requestCount / (duration / 1000);

    console.log(`✓ Performance test passed: ${requestsPerSecond.toFixed(0)} requests/second`);

    assert(requestsPerSecond > 10, 'Should handle at least 10 requests per second');
  }

  async runAll() {
    console.log('\n=== Server Tests ===');
    
    try {
      await this.testServerStartup();
      await this.testFileServing();
      await this.testCORSHeaders();
      await this.testSecurityHeaders();
      await this.testDirectoryTraversalProtection();
      await this.testErrorHandling();
      await this.testDefaultFileServing();
      await this.testConcurrentRequests();
      await this.testPerformance();
      
      console.log('✓ All Server tests passed\n');
    } catch (error) {
      console.error('❌ Server test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.stopServer();
    }
  }
}

// Test suite for HTTP Headers
class HeaderTests {
  constructor() {
    this.server = null;
    this.serverProcess = null;
    this.testPort = 8082;
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      try {
        const { spawn } = require('child_process');
        this.serverProcess = spawn('node', ['server.js'], {
          cwd: __dirname,
          env: { ...process.env, PORT: this.testPort }
        });

        this.serverProcess.stdout.on('data', (data) => {
          if (data.toString().includes('Server listening')) {
            resolve();
          }
        });

        this.serverProcess.on('error', reject);

        setTimeout(() => {
          reject(new Error('Server startup timeout'));
        }, 5000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  async testHeaderConsistency() {
    console.log('Testing header consistency...');

    await this.startServer();

    const testPaths = ['/', '/test.html', '/test.js', '/test.css', '/test.json'];
    
    for (const testPath of testPaths) {
      const response = await ServerTestUtils.makeRequest(this.testPort, testPath);
      
      // All responses should have the same security headers
      assert(response.headers['cross-origin-opener-policy'] === 'same-origin', 
        `Missing COOP header for ${testPath}`);
      assert(response.headers['cross-origin-embedder-policy'] === 'require-corp', 
        `Missing COEP header for ${testPath}`);
      assert(response.headers['x-content-type-options'] === 'nosniff', 
        `Missing X-Content-Type-Options header for ${testPath}`);
      assert(response.headers['x-frame-options'] === 'DENY', 
        `Missing X-Frame-Options header for ${testPath}`);
    }

    console.log('✓ Header consistency tests passed');
  }

  async testContentTypeDetection() {
    console.log('Testing content type detection...');

    // Create test files with various extensions
    const testFiles = [
      { name: 'test.html', expectedType: 'text/html' },
      { name: 'test.js', expectedType: 'application/javascript' },
      { name: 'test.css', expectedType: 'text/css' },
      { name: 'test.json', expectedType: 'application/json' },
      { name: 'test.txt', expectedType: 'text/html' }, // Default fallback
      { name: 'test.unknown', expectedType: 'text/html' } // Default fallback
    ];

    for (const testFile of testFiles) {
      ServerTestUtils.createTestFile(testFile.name, 'test content');
    }

    try {
      for (const testFile of testFiles) {
        const response = await ServerTestUtils.makeRequest(this.testPort, `/${testFile.name}`);
        assert(response.headers['content-type'] === testFile.expectedType, 
          `Wrong content type for ${testFile.name}: expected ${testFile.expectedType}, got ${response.headers['content-type']}`);
      }
    } finally {
      for (const testFile of testFiles) {
        ServerTestUtils.deleteTestFile(testFile.name);
      }
    }

    console.log('✓ Content type detection tests passed');
  }

  async runAll() {
    console.log('\n=== Header Tests ===');
    
    try {
      await this.testHeaderConsistency();
      await this.testContentTypeDetection();
      
      console.log('✓ All Header tests passed\n');
    } catch (error) {
      console.error('❌ Header test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.stopServer();
    }
  }
}

// Test suite for Security
class SecurityTests {
  constructor() {
    this.server = null;
    this.serverProcess = null;
    this.testPort = 8083;
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      try {
        const { spawn } = require('child_process');
        this.serverProcess = spawn('node', ['server.js'], {
          cwd: __dirname,
          env: { ...process.env, PORT: this.testPort }
        });

        this.serverProcess.stdout.on('data', (data) => {
          if (data.toString().includes('Server listening')) {
            resolve();
          }
        });

        this.serverProcess.on('error', reject);

        setTimeout(() => {
          reject(new Error('Server startup timeout'));
        }, 5000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  async testPathTraversalAttacks() {
    console.log('Testing path traversal attacks...');

    await this.startServer();

    const attackPaths = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
      '....//....//etc//passwd',
      '..%2F..%2Fetc%2Fpasswd', // URL encoded
      '..%5C..%5Cwindows%5Csystem32%5Cdrivers%5Cetc%5Chosts', // URL encoded Windows
      '/etc/passwd',
      'C:\\Windows\\System32\\drivers\\etc\\hosts'
    ];

    for (const attackPath of attackPaths) {
      const response = await ServerTestUtils.makeRequest(this.testPort, attackPath);
      assert(response.statusCode === 403, `Should block path traversal: ${attackPath}`);
    }

    console.log('✓ Path traversal attack tests passed');
  }

  async testInjectionAttacks() {
    console.log('Testing injection attacks...');

    const injectionPaths = [
      'test.html<script>alert("xss")</script>',
      'test.js; DROP TABLE users;',
      'test.css{background:url("javascript:alert(1)")}',
      'test.json"; DROP TABLE users; --'
    ];

    for (const injectionPath of injectionPaths) {
      const response = await ServerTestUtils.makeRequest(this.testPort, injectionPath);
      // Should either return 404 or serve the file safely (no execution)
      assert(response.statusCode === 404 || response.statusCode === 200, 
        `Should handle injection safely: ${injectionPath}`);
    }

    console.log('✓ Injection attack tests passed');
  }

  async testLargeRequests() {
    console.log('Testing large request handling...');

    // Test with very long path
    const longPath = '/a'.repeat(10000);
    const response = await ServerTestUtils.makeRequest(this.testPort, longPath);
    
    // Should handle gracefully (either 404 or 403)
    assert(response.statusCode === 404 || response.statusCode === 403, 
      'Should handle large requests gracefully');

    console.log('✓ Large request tests passed');
  }

  async runAll() {
    console.log('\n=== Security Tests ===');
    
    try {
      await this.testPathTraversalAttacks();
      await this.testInjectionAttacks();
      await this.testLargeRequests();
      
      console.log('✓ All Security tests passed\n');
    } catch (error) {
      console.error('❌ Security test failed:', error.message);
      console.error(error.stack);
      throw error;
    } finally {
      await this.stopServer();
    }
  }
}

// Main test runner for server
class ServerTestRunner {
  static async runAllTests() {
    console.log('Starting Server Unit Tests...\n');
    
    try {
      const serverTests = new ServerTests();
      await serverTests.runAll();
      
      const headerTests = new HeaderTests();
      await headerTests.runAll();
      
      const securityTests = new SecurityTests();
      await securityTests.runAll();
      
      console.log('🎉 All Server tests passed successfully!');
      
    } catch (error) {
      console.error('❌ Server test failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Export for use in other test files
module.exports = {
  ServerTestRunner,
  ServerTestUtils,
  ServerTests,
  HeaderTests,
  SecurityTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  ServerTestRunner.runAllTests();
}
