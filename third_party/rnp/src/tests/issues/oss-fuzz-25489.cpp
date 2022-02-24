/*
 * Copyright (c) 2020 [Ribose Inc](https://www.ribose.com).
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1.  Redistributions of source code must retain the above copyright notice,
 *     this list of conditions and the following disclaimer.
 *
 * 2.  Redistributions in binary form must reproduce the above copyright notice,
 *     this list of conditions and the following disclaimer in the documentation
 *     and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "../rnp_tests.h"
#include "../support.h"
#include "librekey/g10_sexp.hpp"

TEST_F(rnp_tests, test_sxp_depth)
{
    s_exp_t     sxp = {};
    const char *bytes;
    size_t      len;
    auto        mksxp = [](size_t depth) {
        std::string data;
        for (size_t i = 0; i < depth; i++) {
            data += "(1:a";
        }
        for (size_t i = 0; i < depth; i++) {
            data += ")";
        }
        return data;
    };

    {
        std::string data(mksxp(1));
        bytes = &data[0];
        len = data.size();
        s_exp_t sexp;
        assert_true(sexp.parse(&bytes, &len));
    }
    {
        std::string data(mksxp(SXP_MAX_DEPTH));
        bytes = &data[0];
        len = data.size();
        s_exp_t sexp;
        assert_true(sexp.parse(&bytes, &len));
    }
    {
        std::string data(mksxp(SXP_MAX_DEPTH + 1));
        bytes = &data[0];
        len = data.size();
        s_exp_t sexp;
        assert_false(sexp.parse(&bytes, &len));
    }
}
