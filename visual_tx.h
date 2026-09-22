/**
 * @file visual_tx.h
 * @brief Visual Data Codec (VCDC) - Low-Level Visual Transmitter & Framebuffer Generator
 *
 * Lightweight, zero-dependency C99 / C++11 header-only library designed for low-level
 * embedded payloads, telemetry broadcasters, and kernel/bare-metal transmitters to stream
 * raw memory buffers over HDMI / DisplayPort as visual pixel frames.
 *
 * KEY FEATURES:
 *  - 100% Pure C99 / C++11 with zero external libraries (no OpenCV, no libpng, no libc requirements beyond stdint/stddef).
 *  - Exact 24-byte VCDC metadata header (Magic "VCDC", Mode, ECC, Payload Length, CRC32, "END\0").
 *  - Byte-to-RGB Mapping: 3 raw bytes per RGB pixel (R = byte[0], G = byte[1], B = byte[2]).
 *  - Embedded Reed-Solomon RS(255, 239) FEC parity generator using GF(2^8) with poly 0x11D.
 *  - Fast HDMI Framebuffer Renderer (RGB888, BGR888, RGBA8888, BGRA8888) with integer pixel scaling (e.g. 10x).
 *  - Can be used as a header-only library or with a separate visual_tx.c compilation unit.
 *
 * USAGE (Header-Only Mode):
 *   In EXACTLY ONE C or C++ source file, define VISUAL_TX_IMPLEMENTATION before including:
 *   #define VISUAL_TX_IMPLEMENTATION
 *   #include "visual_tx.h"
 *
 * USAGE (Traditional Library Mode):
 *   Compile visual_tx.c along with your project and simply #include "visual_tx.h".
 */

#ifndef VISUAL_TX_H
#define VISUAL_TX_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * 1. CONSTANTS & CONFIGURATION
 * ============================================================================ */

#define VCDC_MAGIC_0          'V'
#define VCDC_MAGIC_1          'C'
#define VCDC_MAGIC_2          'D'
#define VCDC_MAGIC_3          'C'

#define VCDC_END_MARKER_0     'E'
#define VCDC_END_MARKER_1     'N'
#define VCDC_END_MARKER_2     'D'
#define VCDC_END_MARKER_3     '\0'

#define VCDC_HEADER_V1_SIZE   24     /* Exact 24-byte Row-0 VCDC Metadata Header */
#define VCDC_HEADER_V2_SIZE   56     /* Extended 56-byte header with SHA-256 */

/* Codec Modes */
#define VCDC_MODE_RGB         1      /* 3 bytes per pixel (Full Color RGB888) */
#define VCDC_MODE_MONO        2      /* 1 byte per pixel (Grayscale / Luminance) */

/* Reed-Solomon RS(255, 239) Constants */
#define VCDC_RS_BLOCK_SIZE    255    /* Total RS block symbol count (N) */
#define VCDC_RS_PARITY_SIZE   16     /* Parity symbols per block (P) -> corrects up to 8 byte errors */
#define VCDC_RS_DATA_SIZE     239    /* Raw data bytes per block (K = N - P) */

/* Standard HDMI Frame Dimensions */
#define VCDC_HDMI_1080P_W     1920
#define VCDC_HDMI_1080P_H     1080
#define VCDC_HDMI_720P_W      1280
#define VCDC_HDMI_720P_H      720
#define VCDC_HDMI_4K_W        3840
#define VCDC_HDMI_4K_H        2160

/* Supported Target Framebuffer Pixel Formats */
typedef enum {
    VCDC_FMT_RGB888 = 0,             /* 24-bit RGB: [R, G, B] */
    VCDC_FMT_BGR888,                 /* 24-bit BGR: [B, G, R] (Linux fbdev default) */
    VCDC_FMT_RGBA8888,               /* 32-bit RGBA: [R, G, B, A=255] (HDMI DRM/KMS, OpenGL, Wayland) */
    VCDC_FMT_BGRA8888,               /* 32-bit BGRA: [B, G, R, A=255] (Windows D3D, DirectFB) */
    VCDC_FMT_ARGB8888                /* 32-bit ARGB: [A=255, R, G, B] */
} vcdc_pixel_format_t;

/* Status Codes */
typedef enum {
    VCDC_OK = 0,
    VCDC_ERR_NULL_POINTER = -1,
    VCDC_ERR_BUFFER_TOO_SMALL = -2,
    VCDC_ERR_INVALID_PARAMETER = -3,
    VCDC_ERR_FRAME_EXCEEDS_FB = -4,
    VCDC_ERR_CORRUPT_HEADER = -5
} vcdc_status_t;

/* 24-bit Color Primitive for Backgrounds / Borders */
typedef struct {
    uint8_t r;
    uint8_t g;
    uint8_t b;
    uint8_t a;
} vcdc_color_t;

/* ============================================================================
 * 2. EXACT 24-BYTE VCDC METADATA HEADER
 * ============================================================================ */

#pragma pack(push, 1)
/**
 * @brief Exact 24-byte Row-0 Visual Codec Header.
 * All multi-byte numeric fields are stored in standard Big-Endian network order.
 */
typedef struct {
    uint8_t  magic[4];         /* 0..3:   Magic bytes "VCDC" */
    uint8_t  mode;             /* 4:      1 = RGB (3 B/px), 2 = Mono (1 B/px) */
    uint8_t  ecc_parity;       /* 5:      Parity bytes per RS block (16 for RS(255, 239); 0 = disabled) */
    uint16_t ecc_block_size;   /* 6..7:   RS block size N in Big-Endian (255) */
    uint64_t payload_len;      /* 8..15:  Payload byte length in Big-Endian */
    uint32_t crc32;            /* 16..19: IEEE 802.3 CRC32 checksum in Big-Endian */
    uint8_t  end_marker[4];    /* 20..23: End marker "END\0" */
} vcdc_header_v1_t;
#pragma pack(pop)

/**
 * @brief Optional Stream Packet Sequence Header.
 * Can be prepended to live stream memory buffers for multi-packet reconstruction.
 */
typedef struct {
    uint32_t sequence_id;      /* Incrementing frame / packet counter */
    uint32_t total_chunks;     /* Total chunks in sequence (or 0 for continuous broadcast) */
    uint64_t timestamp_us;     /* Microsecond timestamp */
} vcdc_stream_seq_t;

/**
 * @brief Represents an unscaled 1x visual pixel grid (Row 0 header + Row 1..H-1 data).
 */
typedef struct {
    int width;                 /* Grid width in pixels (always multiple of 4) */
    int height;                /* Grid height in pixels (1 header row + data rows) */
    size_t payload_bytes;      /* Original raw unencoded payload size */
    size_t encoded_bytes;      /* Total encoded bytes (payload + RS parity) */
    uint32_t crc32;            /* Payload CRC32 */
    uint8_t *rgb_pixels;       /* Pointer to RGB888 pixel buffer (width * height * 3 bytes) */
    size_t rgb_pixels_capacity;/* Size of allocated buffer in bytes */
} vcdc_grid_t;

/* ============================================================================
 * 3. API FUNCTION PROTOTYPES
 * ============================================================================ */

/**
 * @brief Computes standard IEEE 802.3 32-bit CRC checksum.
 * Identical to Python's zlib.crc32() and Ethernet/PNG CRC32.
 *
 * @param data Pointer to input data buffer.
 * @param length Size of data in bytes.
 * @return 32-bit unsigned CRC32 checksum.
 */
uint32_t vcdc_crc32(const uint8_t *data, size_t length);

/**
 * @brief Builds the exact 24-byte Big-Endian VCDC metadata header.
 *
 * @param out_header Pointer to 24-byte header struct to populate.
 * @param payload_length Byte length of raw unencoded payload.
 * @param crc32 Pre-calculated IEEE 802.3 CRC32 checksum of payload.
 * @param mode Codec mode: VCDC_MODE_RGB (1) or VCDC_MODE_MONO (2).
 * @param ecc_parity ECC parity bytes (16 for RS(255, 239); 0 for disabled).
 * @param ecc_block_size ECC block size (255 for RS(255, 239); 0 for disabled).
 */
void vcdc_build_header_24b(
    vcdc_header_v1_t *out_header,
    uint64_t payload_length,
    uint32_t crc32,
    uint8_t mode,
    uint8_t ecc_parity,
    uint16_t ecc_block_size
);

/**
 * @brief Calculates required output buffer size after Reed-Solomon RS(255, 239) encoding.
 *
 * @param payload_len Length of raw input data.
 * @param ecc_parity Number of parity bytes per block (e.g. 16).
 * @param ecc_block_size Block size (e.g. 255).
 * @return Total byte count after appending parity bytes.
 */
size_t vcdc_rs_encoded_size(
    size_t payload_len,
    uint8_t ecc_parity,
    uint16_t ecc_block_size
);

/**
 * @brief Encodes payload with Reed-Solomon RS(255, 239) forward error correction.
 * Chunks data into 239-byte segments and appends 16 parity bytes to each block.
 *
 * @param input Raw input data buffer.
 * @param input_len Length of raw input data.
 * @param output Destination buffer for encoded data (data + parity).
 * @param output_capacity Allocated capacity of output buffer.
 * @param ecc_parity Parity bytes per block (16).
 * @param ecc_block_size Block size N (255).
 * @param out_encoded_len Pointer to receive final encoded byte length.
 * @return VCDC_OK on success, negative error code otherwise.
 */
vcdc_status_t vcdc_rs_encode(
    const uint8_t *input,
    size_t input_len,
    uint8_t *output,
    size_t output_capacity,
    uint8_t ecc_parity,
    uint16_t ecc_block_size,
    size_t *out_encoded_len
);

/**
 * @brief Calculates optimal grid dimensions (width, height) to fit encoded payload + header.
 *
 * @param encoded_bytes_len Total encoded byte length.
 * @param min_width Minimum width (e.g. 64; 24-byte header requires at least 8 RGB pixels).
 * @param out_width Pointer to receive calculated width (always multiple of 4).
 * @param out_height Pointer to receive calculated height (1 header row + data rows).
 */
void vcdc_calculate_grid_dimensions(
    size_t encoded_bytes_len,
    int min_width,
    int *out_width,
    int *out_height
);

/**
 * @brief Encodes raw memory buffer into a 1x Visual RGB Pixel Grid.
 * Row 0 receives the exact 24-byte VCDC header; Row 1..H-1 receive payload + RS parity bytes.
 *
 * @param payload Raw memory buffer.
 * @param payload_len Length of memory buffer in bytes.
 * @param enable_rs 1 to enable Reed-Solomon RS(255, 239) protection, 0 to disable.
 * @param min_grid_width Minimum grid width in pixels (e.g. 64).
 * @param pixel_buffer Pre-allocated memory for RGB pixels (must be >= out_width * out_height * 3).
 * @param pixel_buffer_capacity Size of pixel_buffer in bytes.
 * @param out_grid Struct to receive grid metadata and dimensions.
 * @return VCDC_OK on success, negative error code otherwise.
 */
vcdc_status_t vcdc_encode_frame_rgb(
    const uint8_t *payload,
    size_t payload_len,
    bool enable_rs,
    int min_grid_width,
    uint8_t *pixel_buffer,
    size_t pixel_buffer_capacity,
    vcdc_grid_t *out_grid
);

/**
 * @brief Renders the visual grid directly into an HDMI output framebuffer with integer scaling.
 * Supports centering or custom offsets, multiple pixel formats (RGBA, RGB, BGRA, BGR),
 * and background color fill for margins.
 *
 * @param grid Pointer to encoded 1x visual grid.
 * @param fb Pointer to target HDMI framebuffer memory (e.g. 1920x1080).
 * @param fb_width Framebuffer width in pixels (e.g. 1920).
 * @param fb_height Framebuffer height in pixels (e.g. 1080).
 * @param origin_x Left coordinate for grid (-1 to automatically center horizontally).
 * @param origin_y Top coordinate for grid (-1 to automatically center vertically).
 * @param scale Integer pixel scaling factor (e.g. 10 for 10x pixel blocks).
 * @param format Target framebuffer pixel format (VCDC_FMT_RGBA8888, VCDC_FMT_RGB888, etc.).
 * @param bg_color Color for clearing margins and empty screen regions.
 * @return VCDC_OK on success, negative error code otherwise.
 */
vcdc_status_t vcdc_render_framebuffer(
    const vcdc_grid_t *grid,
    uint8_t *fb,
    int fb_width,
    int fb_height,
    int origin_x,
    int origin_y,
    int scale,
    vcdc_pixel_format_t format,
    vcdc_color_t bg_color
);

/**
 * @brief Convenience helper to export a rendered framebuffer as a standard binary PPM image file.
 * Useful for debugging, visual inspection, or feeding directly into OpenCV test decoders.
 *
 * @param filename Output filepath (e.g. "output_frame.ppm").
 * @param fb Framebuffer pointer.
 * @param width Framebuffer width.
 * @param height Framebuffer height.
 * @param format Framebuffer pixel format.
 * @return VCDC_OK on success, negative error code otherwise.
 */
vcdc_status_t vcdc_export_ppm(
    const char *filename,
    const uint8_t *fb,
    int width,
    int height,
    vcdc_pixel_format_t format
);

#ifdef __cplusplus
}
#endif

/* ============================================================================
 * 4. HEADER-ONLY IMPLEMENTATION
 * ============================================================================ */
#ifdef VISUAL_TX_IMPLEMENTATION

#include <string.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ----------------------------------------------------------------------------
 * Endianness Utilities (Host to Big-Endian Network Byte Order)
 * ---------------------------------------------------------------------------- */
static inline uint16_t vcdc_htons_internal(uint16_t x) {
    return (uint16_t)(((x & 0x00FFU) << 8) | ((x & 0xFF00U) >> 8));
}

static inline uint32_t vcdc_htonl_internal(uint32_t x) {
    return (((x & 0x000000FFU) << 24) |
            ((x & 0x0000FF00U) <<  8) |
            ((x & 0x00FF0000U) >>  8) |
            ((x & 0xFF000000U) >> 24));
}

static inline uint64_t vcdc_htonll_internal(uint64_t x) {
    return (((uint64_t)vcdc_htonl_internal((uint32_t)(x & 0xFFFFFFFFULL))) << 32) |
            ((uint64_t)vcdc_htonl_internal((uint32_t)(x >> 32)));
}

/* ----------------------------------------------------------------------------
 * Precomputed IEEE 802.3 CRC32 Lookup Table (Polynomial 0xEDB88320)
 * ---------------------------------------------------------------------------- */
static const uint32_t VCDC_CRC32_TABLE[256] = {
    0x00000000U, 0x77073096U, 0xEE0E612CU, 0x990951BAU, 0x076DC419U, 0x706AF48FU, 0xE963A535U, 0x9E6495A3U,
    0x0EDB8832U, 0x79DCB8A4U, 0xE0D5E91EU, 0x97D2D988U, 0x09B64C2BU, 0x7EB17CBDU, 0xE7B82D07U, 0x90BF1D91U,
    0x1DB71064U, 0x6AB020F2U, 0xF3B97148U, 0x84BE41DEU, 0x1ADAD47DU, 0x6DDDE4EBU, 0xF4D4B551U, 0x83D385C7U,
    0x136C9856U, 0x646BA8C0U, 0xFD62F97AU, 0x8A65C9ECU, 0x14015C4FU, 0x63066CD9U, 0xFA0F3D63U, 0x8D080DF5U,
    0x3B6E20C8U, 0x4C69105EU, 0xD56041E4U, 0xA2677172U, 0x3C03E4D1U, 0x4B04D447U, 0xD20D85FDU, 0xA50AB56BU,
    0x35B5A8FAU, 0x42B2986CU, 0xDBBBC9D6U, 0xACBCF940U, 0x32D86CE3U, 0x45DF5C75U, 0xDCD60DCFU, 0xABD13D59U,
    0x26D930ACU, 0x51DE003AU, 0xC8D75180U, 0xBFD06116U, 0x21B4F4B5U, 0x56B3C423U, 0xCFBA9599U, 0xB8BDA50FU,
    0x2802B89EU, 0x5F058808U, 0xC60CD9B2U, 0xB10BE924U, 0x2F6F7C87U, 0x58684C11U, 0xC1611DABU, 0xB6662D3DU,
    0x76DC4190U, 0x01DB7106U, 0x98D220BCU, 0xEFD5102AU, 0x71B18589U, 0x06B6B51FU, 0x9FBFE4A5U, 0xE8B8D433U,
    0x7807C9A2U, 0x0F00F934U, 0x9609A88EU, 0xE10E9818U, 0x7F6A0DBBU, 0x086D3D2DU, 0x91646C97U, 0xE6635C01U,
    0x6B6B51F4U, 0x1C6C6162U, 0x856530D8U, 0xF262004EU, 0x6C0695EDU, 0x1B01A57BU, 0x8208F4C1U, 0xF50FC457U,
    0x65B0D9C6U, 0x12B7E950U, 0x8BBEB8EAU, 0xFCB9887CU, 0x62DD1DDFU, 0x15DA2D49U, 0x8CD37CF3U, 0xFBD44C65U,
    0x4DB26158U, 0x3AB551CEU, 0xA3BC0074U, 0xD4BB30E2U, 0x4ADFA541U, 0x3DD895D7U, 0xA4D1C46DU, 0xD3D6F4FBU,
    0x4369E96AU, 0x346ED9FCU, 0xAD678846U, 0xDA60B8D0U, 0x44042D73U, 0x33031DE5U, 0xAA0A4C5FU, 0xDD0D7CC9U,
    0x5005713CU, 0x270241AAU, 0xBE0B1010U, 0xC90C2086U, 0x5768B525U, 0x206F85B3U, 0xB966D409U, 0xCE61E49FU,
    0x5EDEF90EU, 0x29D9C998U, 0xB0D09822U, 0xC7D7A8B4U, 0x59B33D17U, 0x2EB40D81U, 0xB7BD5C3BU, 0xC0BA6CADU,
    0xEDB88320U, 0x9ABFB3B6U, 0x03B6E20CU, 0x74B1D29AU, 0xEAD54739U, 0x9DD277AFU, 0x04DB2615U, 0x73DC1683U,
    0xE3630B12U, 0x94643B84U, 0x0D6D6A3EU, 0x7A6A5AA8U, 0xE40ECF0BU, 0x9309FF9DU, 0x0A00AE27U, 0x7D079EB1U,
    0xF00F9344U, 0x8708A3D2U, 0x1E01F268U, 0x6906C2FEU, 0xF762575DU, 0x806567CBU, 0x196C3671U, 0x6E6B06E7U,
    0xFED41B76U, 0x89D32BE0U, 0x10DA7A5AU, 0x67DD4ACCU, 0xF9B9DF6FU, 0x8EBEEFF9U, 0x17B7BE43U, 0x60B08ED5U,
    0xD6D6A3E8U, 0xA1D1937EU, 0x38D8C2C4U, 0x4FDFF252U, 0xD1BB67F1U, 0xA6BC5767U, 0x3FB506DDU, 0x48B2364BU,
    0xD80D2BDAU, 0xAF0A1B4CU, 0x36034AF6U, 0x41047A60U, 0xDF60EFC3U, 0xA867DF55U, 0x316E8EEFU, 0x4669BE79U,
    0xCB61B38CU, 0xBC66831AU, 0x256FD2A0U, 0x5268E236U, 0xCC0C7795U, 0xBB0B4703U, 0x220216B9U, 0x5505262FU,
    0xC5BA3BBEU, 0xB2BD0B28U, 0x2BB45A92U, 0x5CB36A04U, 0xC2D7FFA7U, 0xB5D0CF31U, 0x2CD99E8BU, 0x5BDEAE1DU,
    0x9B64C2B0U, 0xEC63F226U, 0x756AA39CU, 0x026D930AU, 0x9C0906A9U, 0xEB0E363FU, 0x72076785U, 0x05005713U,
    0x95BF4A82U, 0xE2B87A14U, 0x7BB12BAEU, 0x0CB61B38U, 0x92D28E9BU, 0xE5D5BE0DU, 0x7CDCEFB7U, 0x0BDBDF21U,
    0x86D3D2D4U, 0xF1D4E242U, 0x68DDB3F8U, 0x1FDA836EU, 0x81BE16CDU, 0xF6B9265BU, 0x6FB077E1U, 0x18B74777U,
    0x88085AE6U, 0xFF0F6A70U, 0x66063BCAU, 0x11010B5CU, 0x8F659EFFU, 0xF862AE69U, 0x616BFFD3U, 0x166CCF45U,
    0xA00AE278U, 0xD70DD2EEU, 0x4E048354U, 0x3903B3C2U, 0xA7672661U, 0xD06016F7U, 0x4969474DU, 0x3E6E77DBU,
    0xAED16A4AU, 0xD9D65ADCU, 0x40DF0B66U, 0x37D83BF0U, 0xA9BCAE53U, 0xDEBB9EC5U, 0x47B2CF7FU, 0x30B5FFE9U,
    0xBDBDF21CU, 0xCABAC28AU, 0x53B39330U, 0x24B4A3A6U, 0xBAD03605U, 0xCDD70693U, 0x54DE5729U, 0x23D967BFU,
    0xB3667A2EU, 0xC4614AB8U, 0x5D681B02U, 0x2A6F2B94U, 0xB40BBE37U, 0xC30C8EA1U, 0x5A05DF1BU, 0x2D02EF8DU
};

uint32_t vcdc_crc32(const uint8_t *data, size_t length) {
    if (!data && length > 0) return 0;
    uint32_t crc = 0xFFFFFFFFU;
    for (size_t i = 0; i < length; i++) {
        crc = (crc >> 8) ^ VCDC_CRC32_TABLE[(crc ^ data[i]) & 0xFFU];
    }
    return crc ^ 0xFFFFFFFFU;
}

/* ----------------------------------------------------------------------------
 * Row 0 Header Generation (24-Byte Exact Binary Format)
 * ---------------------------------------------------------------------------- */
void vcdc_build_header_24b(
    vcdc_header_v1_t *out_header,
    uint64_t payload_length,
    uint32_t crc32,
    uint8_t mode,
    uint8_t ecc_parity,
    uint16_t ecc_block_size
) {
    if (!out_header) return;

    out_header->magic[0] = VCDC_MAGIC_0;
    out_header->magic[1] = VCDC_MAGIC_1;
    out_header->magic[2] = VCDC_MAGIC_2;
    out_header->magic[3] = VCDC_MAGIC_3;

    out_header->mode = (mode == VCDC_MODE_MONO) ? VCDC_MODE_MONO : VCDC_MODE_RGB;
    out_header->ecc_parity = ecc_parity;
    out_header->ecc_block_size = vcdc_htons_internal(ecc_block_size);
    out_header->payload_len = vcdc_htonll_internal(payload_length);
    out_header->crc32 = vcdc_htonl_internal(crc32);

    out_header->end_marker[0] = VCDC_END_MARKER_0;
    out_header->end_marker[1] = VCDC_END_MARKER_1;
    out_header->end_marker[2] = VCDC_END_MARKER_2;
    out_header->end_marker[3] = VCDC_END_MARKER_3;
}

/* ----------------------------------------------------------------------------
 * Reed-Solomon RS(255, 239) Galois Field GF(2^8) Tables & Generator
 * Primitive polynomial: 0x11D (285 = x^8 + x^4 + x^3 + x^2 + 1)
 * ---------------------------------------------------------------------------- */
static const uint8_t VCDC_RS_GEN_16[17] = {
    0x01, 0x3B, 0x0D, 0x68, 0xBD, 0x44, 0xD1, 0x1E,
    0x08, 0xA3, 0x41, 0x29, 0xE5, 0x62, 0x32, 0x24, 0x3B
};

static const uint8_t VCDC_GF_LOG[256] = {
    0x00, 0x00, 0x01, 0x19, 0x02, 0x32, 0x1A, 0xC6, 0x03, 0xDF, 0x33, 0xEE, 0x1B, 0x68, 0xC7, 0x4B,
    0x04, 0x64, 0xE0, 0x0E, 0x34, 0x8D, 0xEF, 0x81, 0x1C, 0xC1, 0x69, 0xF8, 0xC8, 0x08, 0x4C, 0x71,
    0x05, 0x8A, 0x65, 0x2F, 0xE1, 0x24, 0x0F, 0x21, 0x35, 0x93, 0x8E, 0xDA, 0xF0, 0x12, 0x82, 0x45,
    0x1D, 0xB5, 0xC2, 0x7D, 0x6A, 0x27, 0xF9, 0xB9, 0xC9, 0x9A, 0x09, 0x78, 0x4D, 0xE4, 0x72, 0xA6,
    0x06, 0xBF, 0x8B, 0x62, 0x66, 0xDD, 0x30, 0xFD, 0xE2, 0x98, 0x25, 0xB3, 0x10, 0x91, 0x22, 0x88,
    0x36, 0xD0, 0x94, 0xCE, 0x8F, 0x96, 0xDB, 0xBD, 0xF1, 0xD2, 0x13, 0x5C, 0x83, 0x38, 0x46, 0x40,
    0x1E, 0x42, 0xB6, 0xA3, 0xC3, 0x48, 0x7E, 0x6E, 0x6B, 0x3A, 0x28, 0x54, 0xFA, 0x85, 0xBA, 0x3D,
    0xCA, 0x5E, 0x9B, 0x9F, 0x0A, 0x15, 0x79, 0x2B, 0x4E, 0xD4, 0xE5, 0xAC, 0x73, 0xF3, 0xA7, 0x57,
    0x07, 0x70, 0xC0, 0xF7, 0x8C, 0x80, 0x63, 0x0D, 0x67, 0x4A, 0xDE, 0xED, 0x31, 0xC5, 0xFE, 0x18,
    0xE3, 0xA5, 0x99, 0x77, 0x26, 0xB8, 0xB4, 0x7C, 0x11, 0x44, 0x92, 0xD9, 0x23, 0x20, 0x89, 0x2E,
    0x37, 0x3F, 0xD1, 0x5B, 0x95, 0xBC, 0xCF, 0xCD, 0x90, 0x87, 0x97, 0xB2, 0xDC, 0xFC, 0xBE, 0x61,
    0xF2, 0x56, 0xD3, 0xAB, 0x14, 0x2A, 0x5D, 0x9E, 0x84, 0x3C, 0x39, 0x53, 0x47, 0x6D, 0x41, 0xA2,
    0x1F, 0x2D, 0x43, 0xD8, 0xB7, 0x7B, 0xA4, 0x76, 0xC4, 0x17, 0x49, 0xEC, 0x7F, 0x0C, 0x6F, 0xF6,
    0x6C, 0xA1, 0x3B, 0x52, 0x29, 0x9D, 0x55, 0xAA, 0xFB, 0x60, 0x86, 0xB1, 0xBB, 0xCC, 0x3E, 0x5A,
    0xCB, 0x59, 0x5F, 0xB0, 0x9C, 0xA9, 0xA0, 0x51, 0x0B, 0xF5, 0x16, 0xEB, 0x7A, 0x75, 0x2C, 0xD7,
    0x4F, 0xAE, 0xD5, 0xE9, 0xE6, 0xE7, 0xAD, 0xE8, 0x74, 0xD6, 0xF4, 0xEA, 0xA8, 0x50, 0x58, 0xAF
};

static const uint8_t VCDC_GF_EXP[512] = {
    0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1D, 0x3A, 0x74, 0xE8, 0xCD, 0x87, 0x13, 0x26,
    0x4C, 0x98, 0x2D, 0x5A, 0xB4, 0x75, 0xEA, 0xC9, 0x8F, 0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0xC0,
    0x9D, 0x27, 0x4E, 0x9C, 0x25, 0x4A, 0x94, 0x35, 0x6A, 0xD4, 0xB5, 0x77, 0xEE, 0xC1, 0x9F, 0x23,
    0x46, 0x8C, 0x05, 0x0A, 0x14, 0x28, 0x50, 0xA0, 0x5D, 0xBA, 0x69, 0xD2, 0xB9, 0x6F, 0xDE, 0xA1,
    0x5F, 0xBE, 0x61, 0xC2, 0x99, 0x2F, 0x5E, 0xBC, 0x65, 0xCA, 0x89, 0x0F, 0x1E, 0x3C, 0x78, 0xF0,
    0xFD, 0xE7, 0xD3, 0xBB, 0x6B, 0xD6, 0xB1, 0x7F, 0xFE, 0xE1, 0xDF, 0xA3, 0x5B, 0xB6, 0x71, 0xE2,
    0xD9, 0xAF, 0x43, 0x86, 0x11, 0x22, 0x44, 0x88, 0x0D, 0x1A, 0x34, 0x68, 0xD0, 0xBD, 0x67, 0xCE,
    0x81, 0x1F, 0x3E, 0x7C, 0xF8, 0xED, 0xC7, 0x93, 0x3B, 0x76, 0xEC, 0xC5, 0x97, 0x33, 0x66, 0xCC,
    0x85, 0x17, 0x2E, 0x5C, 0xB8, 0x6D, 0xDA, 0xA9, 0x4F, 0x9E, 0x21, 0x42, 0x84, 0x15, 0x2A, 0x54,
    0xA8, 0x4D, 0x9A, 0x29, 0x52, 0xA4, 0x55, 0xAA, 0x49, 0x92, 0x39, 0x72, 0xE4, 0xD5, 0xB7, 0x73,
    0xE6, 0xD1, 0xBF, 0x63, 0xC6, 0x91, 0x3F, 0x7E, 0xFC, 0xE5, 0xD7, 0xB3, 0x7B, 0xF6, 0xF1, 0xFF,
    0xE3, 0xDB, 0xAB, 0x4B, 0x96, 0x31, 0x62, 0xC4, 0x95, 0x37, 0x6E, 0xDC, 0xA5, 0x57, 0xAE, 0x41,
    0x82, 0x19, 0x32, 0x64, 0xC8, 0x8D, 0x07, 0x0E, 0x1C, 0x38, 0x70, 0xE0, 0xDD, 0xA7, 0x53, 0xA6,
    0x51, 0xA2, 0x59, 0xB2, 0x79, 0xF2, 0xF9, 0xEF, 0xC3, 0x9B, 0x2B, 0x56, 0xAC, 0x45, 0x8A, 0x09,
    0x12, 0x24, 0x48, 0x90, 0x3D, 0x7A, 0xF4, 0xF5, 0xF7, 0xF3, 0xFB, 0xEB, 0xCB, 0x8B, 0x0B, 0x16,
    0x2C, 0x58, 0xB0, 0x7D, 0xFA, 0xE9, 0xCF, 0x83, 0x1B, 0x36, 0x6C, 0xD8, 0xAD, 0x47, 0x8E, 0x01,
    0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1D, 0x3A, 0x74, 0xE8, 0xCD, 0x87, 0x13, 0x26, 0x4C,
    0x98, 0x2D, 0x5A, 0xB4, 0x75, 0xEA, 0xC9, 0x8F, 0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0xC0, 0x9D,
    0x27, 0x4E, 0x9C, 0x25, 0x4A, 0x94, 0x35, 0x6A, 0xD4, 0xB5, 0x77, 0xEE, 0xC1, 0x9F, 0x23, 0x46,
    0x8C, 0x05, 0x0A, 0x14, 0x28, 0x50, 0xA0, 0x5D, 0xBA, 0x69, 0xD2, 0xB9, 0x6F, 0xDE, 0xA1, 0x5F,
    0xBE, 0x61, 0xC2, 0x99, 0x2F, 0x5E, 0xBC, 0x65, 0xCA, 0x89, 0x0F, 0x1E, 0x3C, 0x78, 0xF0, 0xFD,
    0xE7, 0xD3, 0xBB, 0x6B, 0xD6, 0xB1, 0x7F, 0xFE, 0xE1, 0xDF, 0xA3, 0x5B, 0xB6, 0x71, 0xE2, 0xD9,
    0xAF, 0x43, 0x86, 0x11, 0x22, 0x44, 0x88, 0x0D, 0x1A, 0x34, 0x68, 0xD0, 0xBD, 0x67, 0xCE, 0x81,
    0x1F, 0x3E, 0x7C, 0xF8, 0xED, 0xC7, 0x93, 0x3B, 0x76, 0xEC, 0xC5, 0x97, 0x33, 0x66, 0xCC, 0x85,
    0x17, 0x2E, 0x5C, 0xB8, 0x6D, 0xDA, 0xA9, 0x4F, 0x9E, 0x21, 0x42, 0x84, 0x15, 0x2A, 0x54, 0xA8,
    0x4D, 0x9A, 0x29, 0x52, 0xA4, 0x55, 0xAA, 0x49, 0x92, 0x39, 0x72, 0xE4, 0xD5, 0xB7, 0x73, 0xE6,
    0xD1, 0xBF, 0x63, 0xC6, 0x91, 0x3F, 0x7E, 0xFC, 0xE5, 0xD7, 0xB3, 0x7B, 0xF6, 0xF1, 0xFF, 0xE3,
    0xDB, 0xAB, 0x4B, 0x96, 0x31, 0x62, 0xC4, 0x95, 0x37, 0x6E, 0xDC, 0xA5, 0x57, 0xAE, 0x41, 0x82,
    0x19, 0x32, 0x64, 0xC8, 0x8D, 0x07, 0x0E, 0x1C, 0x38, 0x70, 0xE0, 0xDD, 0xA7, 0x53, 0xA6, 0x51,
    0xA2, 0x59, 0xB2, 0x79, 0xF2, 0xF9, 0xEF, 0xC3, 0x9B, 0x2B, 0x56, 0xAC, 0x45, 0x8A, 0x09, 0x12,
    0x24, 0x48, 0x90, 0x3D, 0x7A, 0xF4, 0xF5, 0xF7, 0xF3, 0xFB, 0xEB, 0xCB, 0x8B, 0x0B, 0x16, 0x2C,
    0x58, 0xB0, 0x7D, 0xFA, 0xE9, 0xCF, 0x83, 0x1B, 0x36, 0x6C, 0xD8, 0xAD, 0x47, 0x8E, 0x01, 0x02
};

static inline uint8_t vcdc_gf_mul(uint8_t a, uint8_t b) {
    if (a == 0 || b == 0) return 0;
    return VCDC_GF_EXP[VCDC_GF_LOG[a] + VCDC_GF_LOG[b]];
}

size_t vcdc_rs_encoded_size(
    size_t payload_len,
    uint8_t ecc_parity,
    uint16_t ecc_block_size
) {
    if (ecc_parity == 0 || ecc_block_size <= ecc_parity) {
        return payload_len;
    }
    size_t k = (size_t)(ecc_block_size - ecc_parity);
    size_t block_count = (payload_len == 0) ? 1 : ((payload_len + k - 1) / k);
    return payload_len + (block_count * (size_t)ecc_parity);
}

vcdc_status_t vcdc_rs_encode(
    const uint8_t *input,
    size_t input_len,
    uint8_t *output,
    size_t output_capacity,
    uint8_t ecc_parity,
    uint16_t ecc_block_size,
    size_t *out_encoded_len
) {
    if (!input && input_len > 0) return VCDC_ERR_NULL_POINTER;
    if (!output) return VCDC_ERR_NULL_POINTER;

    if (ecc_parity == 0) {
        if (output_capacity < input_len) return VCDC_ERR_BUFFER_TOO_SMALL;
        if (input_len > 0) memcpy(output, input, input_len);
        if (out_encoded_len) *out_encoded_len = input_len;
        return VCDC_OK;
    }

    /* Currently optimized for standard RS(255, 239) with 16 parity bytes */
    if (ecc_parity != 16 || ecc_block_size != 255) {
        return VCDC_ERR_INVALID_PARAMETER;
    }

    size_t k = VCDC_RS_DATA_SIZE;  /* 239 */
    size_t needed_size = vcdc_rs_encoded_size(input_len, ecc_parity, ecc_block_size);
    if (output_capacity < needed_size) return VCDC_ERR_BUFFER_TOO_SMALL;

    size_t in_offset = 0;
    size_t out_offset = 0;

    do {
        size_t chunk_len = (input_len - in_offset > k) ? k : (input_len - in_offset);
        const uint8_t *chunk = input + in_offset;

        /* Copy data segment */
        if (chunk_len > 0) {
            memcpy(output + out_offset, chunk, chunk_len);
        }
        out_offset += chunk_len;

        /* Compute 16 parity bytes via synthetic division */
        uint8_t rem[16];
        memset(rem, 0, sizeof(rem));

        for (size_t i = 0; i < chunk_len; i++) {
            uint8_t feedback = chunk[i] ^ rem[0];
            for (size_t j = 0; j < 15; j++) {
                rem[j] = rem[j + 1] ^ vcdc_gf_mul(VCDC_RS_GEN_16[j + 1], feedback);
            }
            rem[15] = vcdc_gf_mul(VCDC_RS_GEN_16[16], feedback);
        }

        /* Append parity segment */
        memcpy(output + out_offset, rem, 16);
        out_offset += 16;

        in_offset += chunk_len;
    } while (in_offset < input_len);

    if (out_encoded_len) *out_encoded_len = out_offset;
    return VCDC_OK;
}

/* ----------------------------------------------------------------------------
 * Grid Geometry & Visual Layout Calculations
 * ---------------------------------------------------------------------------- */
void vcdc_calculate_grid_dimensions(
    size_t encoded_bytes_len,
    int min_width,
    int *out_width,
    int *out_height
) {
    /* RGB mode: 3 bytes per pixel */
    size_t data_pixels = (encoded_bytes_len == 0) ? 1 : ((encoded_bytes_len + 2) / 3);

    /* 24-byte header occupies 8 RGB pixels (24 / 3 = 8) */
    int min_req_w = (min_width > 8) ? min_width : 8;

    /* Find square root approximation for balanced aspect ratio */
    int calculated_w = 1;
    while ((size_t)(calculated_w * calculated_w) < data_pixels) {
        calculated_w++;
    }

    int w = (calculated_w > min_req_w) ? calculated_w : min_req_w;

    /* Align width to a multiple of 4 */
    if (w % 4 != 0) {
        w += (4 - (w % 4));
    }

    /* Row 0 is dedicated to header. Data rows follow in Row 1..H-1 */
    int data_rows = (int)((data_pixels + (size_t)w - 1) / (size_t)w);
    if (data_rows < 1) data_rows = 1;
    int h = 1 + data_rows;

    if (out_width)  *out_width = w;
    if (out_height) *out_height = h;
}

/* ----------------------------------------------------------------------------
 * Full Visual Frame Encoding (Row 0 Header + Row 1..H-1 Data Blocks)
 * ---------------------------------------------------------------------------- */
vcdc_status_t vcdc_encode_frame_rgb(
    const uint8_t *payload,
    size_t payload_len,
    bool enable_rs,
    int min_grid_width,
    uint8_t *pixel_buffer,
    size_t pixel_buffer_capacity,
    vcdc_grid_t *out_grid
) {
    if (!pixel_buffer || !out_grid) return VCDC_ERR_NULL_POINTER;
    if (!payload && payload_len > 0) return VCDC_ERR_NULL_POINTER;

    uint8_t ecc_parity = enable_rs ? VCDC_RS_PARITY_SIZE : 0;
    uint16_t ecc_block = enable_rs ? VCDC_RS_BLOCK_SIZE : 0;

    size_t encoded_len = vcdc_rs_encoded_size(payload_len, ecc_parity, ecc_block);

    int w = 0, h = 0;
    vcdc_calculate_grid_dimensions(encoded_len, min_grid_width, &w, &h);

    size_t required_bytes = (size_t)w * (size_t)h * 3;
    if (pixel_buffer_capacity < required_bytes) {
        return VCDC_ERR_BUFFER_TOO_SMALL;
    }

    /* Initialize entire grid to black */
    memset(pixel_buffer, 0, required_bytes);

    /* 1. Calculate CRC32 of raw payload */
    uint32_t crc = vcdc_crc32(payload, payload_len);

    /* 2. Build exact 24-byte Row-0 header */
    vcdc_header_v1_t hdr;
    vcdc_build_header_24b(&hdr, (uint64_t)payload_len, crc, VCDC_MODE_RGB, ecc_parity, ecc_block);

    /* Write 24-byte header into first 8 pixels of Row 0 */
    const uint8_t *hdr_bytes = (const uint8_t *)&hdr;
    for (int x = 0; x < 8 && x < w; x++) {
        size_t p_offset = (size_t)x * 3;
        pixel_buffer[p_offset + 0] = hdr_bytes[x * 3 + 0];
        pixel_buffer[p_offset + 1] = hdr_bytes[x * 3 + 1];
        pixel_buffer[p_offset + 2] = hdr_bytes[x * 3 + 2];
    }

    /* 3. Encode payload (with RS if enabled) and map to RGB pixels from Row 1 onwards */
    if (enable_rs) {
        /* Temporary stack buffer for encoding chunks or encode directly */
        size_t k = VCDC_RS_DATA_SIZE;
        size_t in_offset = 0;
        size_t pixel_idx = (size_t)w; /* Start at Row 1, column 0 */
        size_t max_pixels = (size_t)w * (size_t)h;

        while (in_offset < payload_len && pixel_idx < max_pixels) {
            size_t chunk_len = (payload_len - in_offset > k) ? k : (payload_len - in_offset);
            const uint8_t *chunk = payload + in_offset;

            /* Compute RS parity */
            uint8_t rem[16];
            memset(rem, 0, sizeof(rem));
            for (size_t i = 0; i < chunk_len; i++) {
                uint8_t feedback = chunk[i] ^ rem[0];
                for (size_t j = 0; j < 15; j++) {
                    rem[j] = rem[j + 1] ^ vcdc_gf_mul(VCDC_RS_GEN_16[j + 1], feedback);
                }
                rem[15] = vcdc_gf_mul(VCDC_RS_GEN_16[16], feedback);
            }

            /* Stream data bytes followed by parity bytes into RGB pixels */
            size_t total_block_bytes = chunk_len + 16;
            for (size_t b = 0; b < total_block_bytes; b += 3) {
                if (pixel_idx >= max_pixels) break;

                uint8_t c0 = (b < chunk_len) ? chunk[b] : rem[b - chunk_len];
                uint8_t c1 = 0;
                uint8_t c2 = 0;

                if (b + 1 < total_block_bytes) {
                    c1 = (b + 1 < chunk_len) ? chunk[b + 1] : rem[(b + 1) - chunk_len];
                }
                if (b + 2 < total_block_bytes) {
                    c2 = (b + 2 < chunk_len) ? chunk[b + 2] : rem[(b + 2) - chunk_len];
                }

                size_t p_offset = pixel_idx * 3;
                pixel_buffer[p_offset + 0] = c0;
                pixel_buffer[p_offset + 1] = c1;
                pixel_buffer[p_offset + 2] = c2;
                pixel_idx++;
            }

            in_offset += chunk_len;
        }
    } else {
        /* RS disabled: straight byte-to-RGB mapping */
        size_t pixel_idx = (size_t)w; /* Start at Row 1 */
        size_t max_pixels = (size_t)w * (size_t)h;

        for (size_t i = 0; i < payload_len; i += 3) {
            if (pixel_idx >= max_pixels) break;

            uint8_t r = payload[i];
            uint8_t g = (i + 1 < payload_len) ? payload[i + 1] : 0;
            uint8_t b = (i + 2 < payload_len) ? payload[i + 2] : 0;

            size_t p_offset = pixel_idx * 3;
            pixel_buffer[p_offset + 0] = r;
            pixel_buffer[p_offset + 1] = g;
            pixel_buffer[p_offset + 2] = b;
            pixel_idx++;
        }
    }

    /* Populate output grid descriptor */
    out_grid->width = w;
    out_grid->height = h;
    out_grid->payload_bytes = payload_len;
    out_grid->encoded_bytes = encoded_len;
    out_grid->crc32 = crc;
    out_grid->rgb_pixels = pixel_buffer;
    out_grid->rgb_pixels_capacity = pixel_buffer_capacity;

    return VCDC_OK;
}

/* ----------------------------------------------------------------------------
 * Direct Framebuffer Rendering with Integer Scaling (RGBA/RGB/BGRA/BGR)
 * ---------------------------------------------------------------------------- */
vcdc_status_t vcdc_render_framebuffer(
    const vcdc_grid_t *grid,
    uint8_t *fb,
    int fb_width,
    int fb_height,
    int origin_x,
    int origin_y,
    int scale,
    vcdc_pixel_format_t format,
    vcdc_color_t bg_color
) {
    if (!grid || !grid->rgb_pixels || !fb) return VCDC_ERR_NULL_POINTER;
    if (fb_width <= 0 || fb_height <= 0 || scale <= 0) return VCDC_ERR_INVALID_PARAMETER;

    int bytes_per_pixel = (format == VCDC_FMT_RGB888 || format == VCDC_FMT_BGR888) ? 3 : 4;
    size_t fb_stride = (size_t)fb_width * (size_t)bytes_per_pixel;

    /* 1. Calculate Grid Display Dimensions */
    int scaled_w = grid->width * scale;
    int scaled_h = grid->height * scale;

    if (scaled_w > fb_width || scaled_h > fb_height) {
        return VCDC_ERR_FRAME_EXCEEDS_FB;
    }

    /* Center grid if negative origin coordinates are provided */
    int ox = (origin_x < 0) ? (fb_width - scaled_w) / 2 : origin_x;
    int oy = (origin_y < 0) ? (fb_height - scaled_h) / 2 : origin_y;

    if (ox + scaled_w > fb_width || oy + scaled_h > fb_height) {
        return VCDC_ERR_FRAME_EXCEEDS_FB;
    }

    /* 2. Clear / Fill Background */
    for (int y = 0; y < fb_height; y++) {
        uint8_t *row_ptr = fb + (size_t)y * fb_stride;
        for (int x = 0; x < fb_width; x++) {
            uint8_t *p = row_ptr + (size_t)x * (size_t)bytes_per_pixel;
            switch (format) {
                case VCDC_FMT_RGB888:
                    p[0] = bg_color.r; p[1] = bg_color.g; p[2] = bg_color.b;
                    break;
                case VCDC_FMT_BGR888:
                    p[0] = bg_color.b; p[1] = bg_color.g; p[2] = bg_color.r;
                    break;
                case VCDC_FMT_RGBA8888:
                    p[0] = bg_color.r; p[1] = bg_color.g; p[2] = bg_color.b; p[3] = bg_color.a;
                    break;
                case VCDC_FMT_BGRA8888:
                    p[0] = bg_color.b; p[1] = bg_color.g; p[2] = bg_color.r; p[3] = bg_color.a;
                    break;
                case VCDC_FMT_ARGB8888:
                    p[0] = bg_color.a; p[1] = bg_color.r; p[2] = bg_color.g; p[3] = bg_color.b;
                    break;
            }
        }
    }

    /* 3. Render Scaled Visual Grid */
    for (int gy = 0; gy < grid->height; gy++) {
        const uint8_t *grid_row = grid->rgb_pixels + ((size_t)gy * (size_t)grid->width * 3);
        int fb_y_start = oy + (gy * scale);

        for (int gx = 0; gx < grid->width; gx++) {
            uint8_t r = grid_row[gx * 3 + 0];
            uint8_t g = grid_row[gx * 3 + 1];
            uint8_t b = grid_row[gx * 3 + 2];
            int fb_x_start = ox + (gx * scale);

            /* Write integer scaled block of pixels */
            for (int dy = 0; dy < scale; dy++) {
                uint8_t *row_ptr = fb + (size_t)(fb_y_start + dy) * fb_stride;
                for (int dx = 0; dx < scale; dx++) {
                    uint8_t *p = row_ptr + (size_t)(fb_x_start + dx) * (size_t)bytes_per_pixel;
                    switch (format) {
                        case VCDC_FMT_RGB888:
                            p[0] = r; p[1] = g; p[2] = b;
                            break;
                        case VCDC_FMT_BGR888:
                            p[0] = b; p[1] = g; p[2] = r;
                            break;
                        case VCDC_FMT_RGBA8888:
                            p[0] = r; p[1] = g; p[2] = b; p[3] = 255;
                            break;
                        case VCDC_FMT_BGRA8888:
                            p[0] = b; p[1] = g; p[2] = r; p[3] = 255;
                            break;
                        case VCDC_FMT_ARGB8888:
                            p[0] = 255; p[1] = r; p[2] = g; p[3] = b;
                            break;
                    }
                }
            }
        }
    }

    return VCDC_OK;
}

/* ----------------------------------------------------------------------------
 * Portable Binary PPM (P6) Image Exporter
 * ---------------------------------------------------------------------------- */
vcdc_status_t vcdc_export_ppm(
    const char *filename,
    const uint8_t *fb,
    int width,
    int height,
    vcdc_pixel_format_t format
) {
    if (!filename || !fb) return VCDC_ERR_NULL_POINTER;
    if (width <= 0 || height <= 0) return VCDC_ERR_INVALID_PARAMETER;

    FILE *fp = fopen(filename, "wb");
    if (!fp) return VCDC_ERR_INVALID_PARAMETER;

    /* Write P6 header (Binary 24-bit RGB) */
    fprintf(fp, "P6\n%d %d\n255\n", width, height);

    int bytes_per_pixel = (format == VCDC_FMT_RGB888 || format == VCDC_FMT_BGR888) ? 3 : 4;
    size_t stride = (size_t)width * (size_t)bytes_per_pixel;

    for (int y = 0; y < height; y++) {
        const uint8_t *row_ptr = fb + (size_t)y * stride;
        for (int x = 0; x < width; x++) {
            const uint8_t *p = row_ptr + (size_t)x * (size_t)bytes_per_pixel;
            uint8_t rgb[3];
            switch (format) {
                case VCDC_FMT_RGB888:
                    rgb[0] = p[0]; rgb[1] = p[1]; rgb[2] = p[2];
                    break;
                case VCDC_FMT_BGR888:
                    rgb[0] = p[2]; rgb[1] = p[1]; rgb[2] = p[0];
                    break;
                case VCDC_FMT_RGBA8888:
                    rgb[0] = p[0]; rgb[1] = p[1]; rgb[2] = p[2];
                    break;
                case VCDC_FMT_BGRA8888:
                    rgb[0] = p[2]; rgb[1] = p[1]; rgb[2] = p[0];
                    break;
                case VCDC_FMT_ARGB8888:
                    rgb[0] = p[1]; rgb[1] = p[2]; rgb[2] = p[3];
                    break;
            }
            fwrite(rgb, 1, 3, fp);
        }
    }

    fclose(fp);
    return VCDC_OK;
}

#ifdef __cplusplus
}
#endif

#endif /* VISUAL_TX_IMPLEMENTATION */

#endif /* VISUAL_TX_H */
