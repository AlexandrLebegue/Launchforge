import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:launchforge_mobile/theme.dart';

void main() {
  test('Forge theme exposes the ember primary color', () {
    expect(Forge.primary, const Color(0xFFFF6B35));
  });
}
