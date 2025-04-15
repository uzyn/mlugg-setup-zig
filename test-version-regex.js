const common = require('./common');
const fs = require('fs').promises;
const path = require('path');
const assert = require('assert');

// Function to create a temporary build.zig.zon file with the given content
async function createTempBuildFile(content) {
  await fs.writeFile('build.zig.zon', content);
}

// Function to run a test
async function runTest(name, buildFileContent, expectedVersion) {
  console.log(`Running test: ${name}`);
  try {
    await createTempBuildFile(buildFileContent);

    // Clear the cached version to ensure a fresh read
    process.env.INPUT_VERSION = '';
    common._cached_version = null;

    const version = await common.getVersion();
    assert.strictEqual(version, expectedVersion, `Expected version ${expectedVersion}, but got ${version}`);
    console.log(`✅ Test passed: ${name}`);
  } catch (err) {
    console.error(`❌ Test failed: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Clean up function
async function cleanup() {
  try {
    await fs.unlink('build.zig.zon');
  } catch (err) {
    // Ignore if file doesn't exist
  }
}

// Main test function
async function runTests() {
  try {
    // Test with period prefix
    await runTest(
      'With period prefix',
      `.minimum_zig_version = "0.11.0";`,
      '0.11.0'
    );

    // Test without period prefix
    await runTest(
      'Without period prefix',
      `minimum_zig_version = "0.12.0";`,
      '0.12.0'
    );

    // Test with whitespace
    await runTest(
      'With whitespace',
      `
      .    minimum_zig_version    =    "0.13.0"   ;
      `,
      '0.13.0'
    );

    // Test with development version format
    await runTest(
      'With development version format',
      `.minimum_zig_version = "0.15.0-dev.345+ec2888858",`,
      '0.15.0-dev.345+ec2888858'
    );

    console.log('All tests completed successfully!');
  } finally {
    await cleanup();
  }
}

// Run the tests
runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exitCode = 1;
});
