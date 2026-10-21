#!/usr/bin/env python3
"""Embed a Windows application icon into an unsigned 64-bit PE executable.
Uses Python's standard library. No external packagers, network or PE SDK required.
Only works on Windows PE32+ binaries without an existing resource directory.
"""
import argparse
import pathlib
import struct


def align(value, size):
    return (value + size - 1) // size * size


def build_resource(ico_data, resource_rva):
    if len(ico_data) < 6:
        raise ValueError('Invalid icon')
    reserved, icon_type, count = struct.unpack_from('<HHH', ico_data)
    if reserved != 0 or icon_type != 1 or not 1 <= count <= 32:
        raise ValueError('Invalid ICO header')
    resources = []
    group = bytearray(struct.pack('<HHH', 0, 1, count))
    for idx in range(count):
        entry = ico_data[6 + 16*idx:6 + 16*(idx+1)]
        if len(entry) != 16:
            raise ValueError('Truncated icon directory')
        w, h, palette, reserved, planes, bitcount, length, offset = struct.unpack('<BBBBHHII', entry)
        if offset + length > len(ico_data) or length <= 0:
            raise ValueError('Invalid ICO bitmap offset')
        icon_id = idx + 1
        image = ico_data[offset:offset+length]
        resources.append((3, icon_id, image))
        group.extend(struct.pack('<BBBBHHIH', w, h, palette, reserved, planes, bitcount, length, icon_id))
    resources.append((14, 1, bytes(group)))

    section = bytearray()
    def reserve(n, boundary=4):
        start = align(len(section), boundary)
        section.extend(bytes(start - len(section) + n))
        return start
    def dirheader(at, ids):
        struct.pack_into('<IIHHHH', section, at, 0, 0, 0, 0, 0, ids)
    root = reserve(16 + 8*2)
    dirheader(root, 2)
    type_ids = sorted({r[0] for r in resources})
    for root_i, typ in enumerate(type_ids):
        entries = [r for r in resources if r[0] == typ]
        type_pos = reserve(16 + len(entries)*8)
        dirheader(type_pos, len(entries))
        struct.pack_into('<II', section, root+16+root_i*8, typ, type_pos|0x80000000)
        for item_i, (_, res_id, contents) in enumerate(entries):
            lang_pos = reserve(24)
            dirheader(lang_pos, 1)
            struct.pack_into('<II', section, type_pos+16+item_i*8, res_id, lang_pos|0x80000000)
            entry_pos = reserve(16)
            struct.pack_into('<II', section, lang_pos+16, 1033, entry_pos)
            payload_pos = reserve(len(contents))
            section[payload_pos:payload_pos+len(contents)] = contents
            struct.pack_into('<IIII', section, entry_pos, resource_rva+payload_pos, len(contents), 0, 0)
    return bytes(section)


def patch(input_path, ico_path, output_path):
    raw = bytearray(pathlib.Path(input_path).read_bytes())
    ico = pathlib.Path(ico_path).read_bytes()
    if raw[:2] != b'MZ':
        raise ValueError('Not a Windows executable')
    pe_off = struct.unpack_from('<I', raw, 0x3c)[0]
    if raw[pe_off:pe_off+4] != b'PE\x00\x00':
        raise ValueError('PE signature not found')
    number_of_sections = struct.unpack_from('<H', raw, pe_off+6)[0]
    size_optional = struct.unpack_from('<H', raw, pe_off+20)[0]
    opt = pe_off+24
    if struct.unpack_from('<H', raw, opt)[0] != 0x20b:
        raise ValueError('Expected x64 PE32+')
    section_table = opt+size_optional
    next_section_header = section_table + number_of_sections*40
    size_headers = struct.unpack_from('<I', raw, opt+60)[0]
    if next_section_header + 40 > size_headers:
        raise ValueError('No room for new section in the PE header')
    if struct.unpack_from('<II', raw, opt+112+2*8) != (0,0):
        raise ValueError('EXE already has resources; refuse to overwrite them')
    file_align = struct.unpack_from('<I', raw, opt+36)[0]
    section_align = struct.unpack_from('<I', raw, opt+32)[0]
    last_section = section_table + (number_of_sections-1)*40
    last_vsize,last_rva,last_rawsize,last_rawptr = struct.unpack_from('<IIII', raw,last_section+8)
    rva = align(last_rva+max(last_vsize,last_rawsize), section_align)
    offset = align(len(raw), file_align)
    section_data = build_resource(ico, rva)
    padded = align(len(section_data), file_align)
    raw.extend(bytes(offset-len(raw)))
    raw.extend(section_data)
    raw.extend(bytes(padded-len(section_data)))
    struct.pack_into('<8sIIIIIIHHI', raw, next_section_header, b'.rsrc\x00\x00\x00',
                     len(section_data),rva,padded,offset,0,0,0,0,0x40000040)
    struct.pack_into('<H', raw, pe_off+6, number_of_sections+1)
    struct.pack_into('<I', raw, opt+56,align(rva+len(section_data), section_align))
    old_init = struct.unpack_from('<I',raw,opt+8)[0]
    struct.pack_into('<I',raw,opt+8,old_init+padded)
    struct.pack_into('<II', raw,opt+112+2*8,rva,len(section_data))
    # Checksum is optional for user-mode Windows EXEs, but calculate it for good hygiene.
    struct.pack_into('<I',raw,opt+64,0)
    checksum=0
    for i in range(0,len(raw),2):
        word = raw[i] | ((raw[i+1] if i+1<len(raw) else 0)<<8)
        checksum += word
        checksum = (checksum & 0xffff) + (checksum>>16)
    checksum = (checksum & 0xffff) + (checksum>>16)
    checksum += len(raw)
    struct.pack_into('<I',raw,opt+64,checksum&0xffffffff)
    pathlib.Path(output_path).write_bytes(raw)
    print(f'Icon embedded: {output_path} (images: {struct.unpack_from("<H", ico,4)[0]}, resource RVA: {rva:#x})')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('executable')
    parser.add_argument('icon')
    parser.add_argument('--out',default=None)
    a=parser.parse_args()
    patch(a.executable,a.icon,a.out or a.executable)
