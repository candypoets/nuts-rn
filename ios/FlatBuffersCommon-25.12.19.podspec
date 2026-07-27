Pod::Spec.new do |spec|
  spec.name = 'Common'
  spec.version = '25.12.19'
  spec.summary = 'Shared Swift types for FlatBuffers'
  spec.homepage = 'https://github.com/google/flatbuffers'
  spec.license = { :type => 'Apache-2.0', :file => 'LICENSE' }
  spec.authors = { 'Google' => 'flatbuffers@googlegroups.com' }
  spec.source = {
    :git => 'https://github.com/google/flatbuffers.git',
    :tag => 'v25.12.19'
  }
  spec.ios.deployment_target = '11.0'
  spec.osx.deployment_target = '10.14'
  spec.swift_version = '5.10'
  spec.source_files = 'swift/Sources/Common/*.swift'
  spec.pod_target_xcconfig = {
    'BUILD_LIBRARY_FOR_DISTRIBUTION' => 'YES'
  }
end
