/* automatically generated by rust-bindgen 0.66.1 */

pub type __kernel_old_dev_t = crate::ctypes::c_ulong;
pub type __kernel_long_t = crate::ctypes::c_long;
pub type __kernel_ulong_t = crate::ctypes::c_ulong;
pub type __kernel_ino_t = __kernel_ulong_t;
pub type __kernel_mode_t = crate::ctypes::c_uint;
pub type __kernel_pid_t = crate::ctypes::c_int;
pub type __kernel_ipc_pid_t = crate::ctypes::c_int;
pub type __kernel_uid_t = crate::ctypes::c_uint;
pub type __kernel_gid_t = crate::ctypes::c_uint;
pub type __kernel_suseconds_t = __kernel_long_t;
pub type __kernel_daddr_t = crate::ctypes::c_int;
pub type __kernel_uid32_t = crate::ctypes::c_uint;
pub type __kernel_gid32_t = crate::ctypes::c_uint;
pub type __kernel_old_uid_t = __kernel_uid_t;
pub type __kernel_old_gid_t = __kernel_gid_t;
pub type __kernel_size_t = __kernel_ulong_t;
pub type __kernel_ssize_t = __kernel_long_t;
pub type __kernel_ptrdiff_t = __kernel_long_t;
pub type __kernel_off_t = __kernel_long_t;
pub type __kernel_loff_t = crate::ctypes::c_longlong;
pub type __kernel_old_time_t = __kernel_long_t;
pub type __kernel_time_t = __kernel_long_t;
pub type __kernel_time64_t = crate::ctypes::c_longlong;
pub type __kernel_clock_t = __kernel_long_t;
pub type __kernel_timer_t = crate::ctypes::c_int;
pub type __kernel_clockid_t = crate::ctypes::c_int;
pub type __kernel_caddr_t = *mut crate::ctypes::c_char;
pub type __kernel_uid16_t = crate::ctypes::c_ushort;
pub type __kernel_gid16_t = crate::ctypes::c_ushort;
pub type __s8 = crate::ctypes::c_schar;
pub type __u8 = crate::ctypes::c_uchar;
pub type __s16 = crate::ctypes::c_short;
pub type __u16 = crate::ctypes::c_ushort;
pub type __s32 = crate::ctypes::c_int;
pub type __u32 = crate::ctypes::c_uint;
pub type __s64 = crate::ctypes::c_long;
pub type __u64 = crate::ctypes::c_ulong;
pub type __kernel_key_t = crate::ctypes::c_int;
pub type __kernel_mqd_t = crate::ctypes::c_int;
pub type __le16 = __u16;
pub type __be16 = __u16;
pub type __le32 = __u32;
pub type __be32 = __u32;
pub type __le64 = __u64;
pub type __be64 = __u64;
pub type __sum16 = __u16;
pub type __wsum = __u32;
pub type __poll_t = crate::ctypes::c_uint;
#[repr(C)]
#[repr(align(16))]
#[derive(Debug, Copy, Clone)]
pub struct __vector128 {
pub u: [__u32; 4usize],
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct loop_info {
pub lo_number: crate::ctypes::c_int,
pub lo_device: __kernel_old_dev_t,
pub lo_inode: crate::ctypes::c_ulong,
pub lo_rdevice: __kernel_old_dev_t,
pub lo_offset: crate::ctypes::c_int,
pub lo_encrypt_type: crate::ctypes::c_int,
pub lo_encrypt_key_size: crate::ctypes::c_int,
pub lo_flags: crate::ctypes::c_int,
pub lo_name: [crate::ctypes::c_char; 64usize],
pub lo_encrypt_key: [crate::ctypes::c_uchar; 32usize],
pub lo_init: [crate::ctypes::c_ulong; 2usize],
pub reserved: [crate::ctypes::c_char; 4usize],
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct loop_info64 {
pub lo_device: __u64,
pub lo_inode: __u64,
pub lo_rdevice: __u64,
pub lo_offset: __u64,
pub lo_sizelimit: __u64,
pub lo_number: __u32,
pub lo_encrypt_type: __u32,
pub lo_encrypt_key_size: __u32,
pub lo_flags: __u32,
pub lo_file_name: [__u8; 64usize],
pub lo_crypt_name: [__u8; 64usize],
pub lo_encrypt_key: [__u8; 32usize],
pub lo_init: [__u64; 2usize],
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct loop_config {
pub fd: __u32,
pub block_size: __u32,
pub info: loop_info64,
pub __reserved: [__u64; 8usize],
}
pub const LO_NAME_SIZE: u32 = 64;
pub const LO_KEY_SIZE: u32 = 32;
pub const LO_CRYPT_NONE: u32 = 0;
pub const LO_CRYPT_XOR: u32 = 1;
pub const LO_CRYPT_DES: u32 = 2;
pub const LO_CRYPT_FISH2: u32 = 3;
pub const LO_CRYPT_BLOW: u32 = 4;
pub const LO_CRYPT_CAST128: u32 = 5;
pub const LO_CRYPT_IDEA: u32 = 6;
pub const LO_CRYPT_DUMMY: u32 = 9;
pub const LO_CRYPT_SKIPJACK: u32 = 10;
pub const LO_CRYPT_CRYPTOAPI: u32 = 18;
pub const MAX_LO_CRYPT: u32 = 20;
pub const LOOP_SET_FD: u32 = 19456;
pub const LOOP_CLR_FD: u32 = 19457;
pub const LOOP_SET_STATUS: u32 = 19458;
pub const LOOP_GET_STATUS: u32 = 19459;
pub const LOOP_SET_STATUS64: u32 = 19460;
pub const LOOP_GET_STATUS64: u32 = 19461;
pub const LOOP_CHANGE_FD: u32 = 19462;
pub const LOOP_SET_CAPACITY: u32 = 19463;
pub const LOOP_SET_DIRECT_IO: u32 = 19464;
pub const LOOP_SET_BLOCK_SIZE: u32 = 19465;
pub const LOOP_CONFIGURE: u32 = 19466;
pub const LOOP_CTL_ADD: u32 = 19584;
pub const LOOP_CTL_REMOVE: u32 = 19585;
pub const LOOP_CTL_GET_FREE: u32 = 19586;
pub const LO_FLAGS_READ_ONLY: _bindgen_ty_1 = _bindgen_ty_1::LO_FLAGS_READ_ONLY;
pub const LO_FLAGS_AUTOCLEAR: _bindgen_ty_1 = _bindgen_ty_1::LO_FLAGS_AUTOCLEAR;
pub const LO_FLAGS_PARTSCAN: _bindgen_ty_1 = _bindgen_ty_1::LO_FLAGS_PARTSCAN;
pub const LO_FLAGS_DIRECT_IO: _bindgen_ty_1 = _bindgen_ty_1::LO_FLAGS_DIRECT_IO;
#[repr(u32)]
#[non_exhaustive]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum _bindgen_ty_1 {
LO_FLAGS_READ_ONLY = 1,
LO_FLAGS_AUTOCLEAR = 4,
LO_FLAGS_PARTSCAN = 8,
LO_FLAGS_DIRECT_IO = 16,
}
